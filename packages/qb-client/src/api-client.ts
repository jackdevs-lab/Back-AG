import axios, { AxiosInstance, AxiosError } from 'axios';
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

export class QbApiClient {
    private client: AxiosInstance;
    private realmId: string;
    private token: string;

    constructor(realmId: string, token: string) {
        this.realmId = realmId;
        this.token = token;

        this.client = axios.create({
            baseURL: 'https://sandbox-quickbooks.api.intuit.com/v3',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Intuit-RealmId': realmId,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        axiosRetry(this.client, {
            retries: 3,
            retryDelay: axiosRetry.exponentialDelay,
            retryCondition: (error) => {
                return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
                    error.response?.status === 429; // Rate limit
            },
            onRetry: (retryCount, error) => {
                logger.warn(`QB API retry ${retryCount}`, {
                    realmId: this.realmId,
                    error: error.message
                });
            }
        });

        // Rate limiting: 10 requests per second
        let lastRequestTime = 0;
        const minRequestInterval = 100; // 100ms between requests

        this.client.interceptors.request.use(async (config) => {
            const now = Date.now();
            const timeSinceLastRequest = now - lastRequestTime;

            if (timeSinceLastRequest < minRequestInterval) {
                await new Promise(resolve =>
                    setTimeout(resolve, minRequestInterval - timeSinceLastRequest)
                );
            }

            lastRequestTime = Date.now();
            return config;
        });
    }

    async query<T>(entityType: string, whereClause: string = '', maxResults: number = 100): Promise<T[]> {
        const allResults: T[] = [];
        let startPosition = 1;

        do {
            const query = `SELECT * FROM ${entityType} ${whereClause} MAXRESULTS ${maxResults} STARTPOSITION ${startPosition}`;

            try {
                const response = await this.client.get<QbQueryResponse<T>>(`/company/${this.realmId}/query`, {
                    params: { query }
                });

                const results = response.data.QueryResponse[entityType] || [];
                allResults.push(...results);

                startPosition += maxResults;

                if (results.length < maxResults) {
                    break;
                }
            } catch (error) {
                const axiosError = error as AxiosError;
                logger.error('QB Query failed', axiosError as Error, { entityType, startPosition });
                throw error;
            }
        } while (true);

        return allResults;
    }

    async get<T>(endpoint: string, id: string): Promise<T> {
        const response = await this.client.get<T>(`/company/${this.realmId}/${endpoint}/${id}`);
        return response.data;
    }

    async getCompanyInfo() {
        const response = await this.client.get(`/company/${this.realmId}/companyinfo/1`);
        return response.data;
    }
}

export async function createQbClient(realmId: string, tenantId: string): Promise<QbApiClient> {
    const token = await oauthService.refreshIfNeeded(realmId, tenantId);
    return new QbApiClient(realmId, token);
}