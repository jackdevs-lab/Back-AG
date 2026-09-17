import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import axiosRetry from 'axios-retry';
import { logger } from '@qb-health/utils';
import { oauthService } from './oauth';

export interface QbQueryResponse<T> {
    QueryResponse: {
        [key: string]: any;
        startPosition: number;
        maxResults: number;
        totalCount?: number;
    };
    time: string;
}

export interface QbCdcDeletedObject {
    name: string;
    id: string;
    status: string;
}

export interface QbCdcResponse {
    CDCResponse: Array<{
        QueryResponse: Array<{
            [key: string]: any;
            deletedObject?: QbCdcDeletedObject[];
        }>;
    }>;
    time: string;
}

interface QbRequestConfig extends InternalAxiosRequestConfig {
    _retry?: boolean;
}

export class QbApiClient {
    private client: AxiosInstance;
    private realmId: string;
    private tenantId: string;
    private token: string;

    private requestQueue: Promise<void> = Promise.resolve();
    private lastRequestTime: number = 0;
    private readonly minRequestInterval = 125;

    private refreshTokenPromise: Promise<string> | null = null;

    constructor(realmId: string, tenantId: string, token: string) {
        this.realmId = realmId;
        this.tenantId = tenantId;
        this.token = token;

        const isProduction = process.env.QB_ENVIRONMENT?.toLowerCase() === 'production';
        const baseURL = isProduction
            ? 'https://quickbooks.api.intuit.com/v3'
            : 'https://sandbox-quickbooks.api.intuit.com/v3';

        this.client = axios.create({
            baseURL,
            timeout: 30_000,
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Intuit-RealmId': this.realmId,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            params: {
                minorversion: 65
            }
        });

        axiosRetry(this.client, {
            retries: 3,
            retryDelay: axiosRetry.exponentialDelay,
            retryCondition: (error) => {
                return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
                    error.response?.status === 429;
            },
            onRetry: (retryCount, error) => {
                logger.warn(`QB API retry ${retryCount}`, {
                    realmId: this.realmId,
                    tenantId: this.tenantId,
                    error: error.message
                });
            }
        });

        this.client.interceptors.request.use((config) => {
            return new Promise<InternalAxiosRequestConfig>((resolve) => {
                this.requestQueue = this.requestQueue
                    .catch(() => { })
                    .then(async () => {
                        const now = Date.now();
                        const timeSinceLastRequest = now - this.lastRequestTime;

                        if (timeSinceLastRequest < this.minRequestInterval) {
                            const waitTime = this.minRequestInterval - timeSinceLastRequest;
                            await new Promise((r) => setTimeout(r, waitTime));
                        }

                        this.lastRequestTime = Date.now();
                        config.headers['Authorization'] = `Bearer ${this.token}`;
                        resolve(config);
                    });
            });
        });

        this.client.interceptors.response.use(
            (response) => response,
            async (error: AxiosError) => {
                const originalRequest = error.config as QbRequestConfig;

                if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
                    originalRequest._retry = true;

                    try {
                        if (!this.refreshTokenPromise) {
                            logger.info('401 Unauthorized encountered. Refreshing QB token mid-flight', {
                                realmId: this.realmId,
                                tenantId: this.tenantId
                            });

                            const refreshPromise = oauthService.refreshIfNeeded(this.realmId, this.tenantId);
                            this.refreshTokenPromise = refreshPromise;

                            refreshPromise.finally(() => {
                                setImmediate(() => {
                                    if (this.refreshTokenPromise === refreshPromise) {
                                        this.refreshTokenPromise = null;
                                    }
                                });
                            });
                        }

                        const newToken = await this.refreshTokenPromise;
                        this.token = newToken;

                        this.client.defaults.headers['Authorization'] = `Bearer ${this.token}`;
                        originalRequest.headers['Authorization'] = `Bearer ${this.token}`;

                        return this.client(originalRequest);
                    } catch (refreshError) {
                        logger.error('Mid-flight token refresh failed', refreshError as Error, {
                            realmId: this.realmId,
                            tenantId: this.tenantId
                        });
                        return Promise.reject(refreshError);
                    }
                }

                return Promise.reject(error);
            }
        );
    }

    private extractQbFault(error: AxiosError): Record<string, any> {
        const data = error.response?.data as any;

        if (data?.Fault) {
            const fault = data.Fault;
            const errors = Array.isArray(fault.Error)
                ? fault.Error.map((err: any) => ({
                    code: err.code,
                    message: err.Message,
                    detail: err.Detail,
                    element: err.element,
                }))
                : [];

            return {
                faultType: fault.type,
                errors,
                statusCode: error.response?.status,
            };
        }

        return {
            message: error.message,
            statusCode: error.response?.status,
        };
    }

    /**
     * Fetch a single page of records for an entity.
     *
     * Pagination is owned by the caller (see SyncEngine.fetchAndProcessPaged).
     * This method issues exactly one HTTP request and returns exactly one page.
     *
     * @param entityType    QB entity, e.g. "Customer"
     * @param whereClause   Optional clause including the leading WHERE, e.g. "WHERE Active = true"
     * @param pageSize      1..1000 (QB hard cap)
     * @param startPosition 1-based offset
     */
    async query<T>(
        entityType: string,
        whereClause: string = '',
        pageSize: number = 500,
        startPosition: number = 1
    ): Promise<T[]> {
        const safePageSize = Math.min(Math.max(1, pageSize), 1000);
        const safeStartPosition = Math.max(1, startPosition);

        let normalized = whereClause.trim();

        // Strip any embedded pagination commands
        normalized = normalized
            .replace(/STARTPOSITION\s+\d+/gi, '')
            .replace(/MAXRESULTS\s+\d+/gi, '');

        // Ensure leading WHERE keyword if clause is non-empty
        if (normalized && !/^WHERE\s/i.test(normalized)) {
            normalized = `WHERE ${normalized}`;
        }

        const queryString = `SELECT * FROM ${entityType} ${normalized} MAXRESULTS ${safePageSize} STARTPOSITION ${safeStartPosition}`
            .replace(/\s+/g, ' ')
            .trim();

        try {
            const response = await this.client.get<QbQueryResponse<T>>(
                `/company/${this.realmId}/query`,
                { params: { query: queryString } }
            );

            const queryResponse = response.data?.QueryResponse || {};

            const matchedKey = Object.keys(queryResponse).find(
                (key) => key.toLowerCase() === entityType.toLowerCase()
            );

            return (matchedKey ? queryResponse[matchedKey] : []) as T[];
        } catch (error) {
            const axiosError = error as AxiosError;
            const qbFault = this.extractQbFault(axiosError);

            logger.error('QB Query failed', axiosError, {
                entityType,
                whereClause,
                pageSize: safePageSize,
                startPosition: safeStartPosition,
                realmId: this.realmId,
                tenantId: this.tenantId,
                qbFault
            });
            throw error;
        }
    }

    async cdc(entities: string[], changedSince: string): Promise<QbCdcResponse> {
        let normalizedChangedSince = changedSince;

        try {
            normalizedChangedSince = new Date(changedSince).toISOString().split('.')[0] + 'Z';

            const response = await this.client.get<QbCdcResponse>(`/company/${this.realmId}/cdc`, {
                params: {
                    entities: entities.join(','),
                    changedSince: normalizedChangedSince
                }
            });
            return response.data;
        } catch (error) {
            const axiosError = error as AxiosError;
            const qbFault = this.extractQbFault(axiosError);

            logger.error('QB CDC request failed', axiosError, {
                entities,
                changedSince: normalizedChangedSince,
                realmId: this.realmId,
                tenantId: this.tenantId,
                qbFault
            });
            throw error;
        }
    }

    async get<T>(endpoint: string, id: string): Promise<T> {
        try {
            const response = await this.client.get(`/company/${this.realmId}/${endpoint}/${id}`);

            const matchedKey = Object.keys(response.data || {}).find(
                key => key.toLowerCase() === endpoint.toLowerCase()
            );
            return matchedKey ? response.data[matchedKey] : response.data;
        } catch (error) {
            const axiosError = error as AxiosError;
            const qbFault = this.extractQbFault(axiosError);

            logger.error(`QB Get failed for ${endpoint}/${id}`, axiosError, {
                endpoint,
                id,
                realmId: this.realmId,
                tenantId: this.tenantId,
                qbFault
            });
            throw error;
        }
    }

    async getCompanyInfo() {
        return this.get('companyinfo', '1');
    }
}

export async function createQbClient(realmId: string, tenantId: string): Promise<QbApiClient> {
    const token = await oauthService.refreshIfNeeded(realmId, tenantId);
    return new QbApiClient(realmId, tenantId, token);
}