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

interface QbRequestConfig extends InternalAxiosRequestConfig {
    _retry?: boolean;
}

export class QbApiClient {
    private client: AxiosInstance;
    private realmId: string;
    private tenantId: string;
    private token: string;

    // Rate Limiter Queue State
    private requestQueue: Promise<void> = Promise.resolve();
    private lastRequestTime: number = 0;
    private readonly minRequestInterval = 125; // 125ms = max 8 req/sec (< 500 req/min limit)

    // Mutex Lock for Mid-Flight Token Refresh
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

        // 1. Retry Logic for Transient Network Failures & 429 Status Codes
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

        // 2. Sequential Request Interceptor (Fixes Promise.all Rate Limiter Race Conditions)
        this.client.interceptors.request.use((config) => {
            return new Promise<InternalAxiosRequestConfig>((resolve) => {
                this.requestQueue = this.requestQueue
                    .catch(() => { }) // Prevent queue deadlocks on failed requests
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

        // 3. Response Interceptor (Mid-Flight 401 Automatic Token Refresh & Request Replay)
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

                            this.refreshTokenPromise = oauthService
                                .refreshIfNeeded(this.realmId, this.tenantId)
                                .finally(() => {
                                    this.refreshTokenPromise = null;
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

    /**
     * Safely parses Intuit-specific Fault error structures from response data.
     */
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

    async query<T>(entityType: string, whereClause: string = '', maxResults: number = 1000): Promise<T[]> {
        const allResults: T[] = [];
        let startPosition = 1;

        // Clamp MAXRESULTS to Intuit's hard limit (1000)
        const safeMaxResults = Math.min(Math.max(1, maxResults), 1000);

        do {
            const query = `SELECT * FROM ${entityType} ${whereClause} MAXRESULTS ${safeMaxResults} STARTPOSITION ${startPosition}`.trim();

            try {
                const response = await this.client.get<QbQueryResponse<T>>(`/company/${this.realmId}/query`, {
                    params: { query }
                });

                const queryResponse = response.data?.QueryResponse || {};

                // Case-insensitive key match (e.g. "Vendor" vs "vendor")
                const matchedKey = Object.keys(queryResponse).find(
                    (key) => key.toLowerCase() === entityType.toLowerCase()
                );

                const results = (matchedKey ? queryResponse[matchedKey] : []) as T[];
                allResults.push(...results);

                startPosition += safeMaxResults;

                if (results.length < safeMaxResults) {
                    break;
                }
            } catch (error) {
                const axiosError = error as AxiosError;
                const qbFault = this.extractQbFault(axiosError);

                logger.error('QB Query failed', axiosError, {
                    entityType,
                    startPosition,
                    safeMaxResults,
                    realmId: this.realmId,
                    tenantId: this.tenantId,
                    qbFault
                });
                throw error;
            }
        } while (true);

        return allResults;
    }

    async get<T>(endpoint: string, id: string): Promise<T> {
        try {
            const response = await this.client.get(`/company/${this.realmId}/${endpoint}/${id}`);

            // Case-insensitive entity key extraction for single entity responses
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