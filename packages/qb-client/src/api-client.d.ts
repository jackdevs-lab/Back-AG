export interface QbQueryResponse<T> {
    QueryResponse: {
        [key: string]: any;
        startPosition: number;
        maxResults: number;
        totalCount?: number;
    };
    time: string;
}
export declare class QbApiClient {
    private client;
    private realmId;
    private token;
    constructor(realmId: string, token: string);
    query<T>(entityType: string, whereClause?: string, maxResults?: number): Promise<T[]>;
    get<T>(endpoint: string, id: string): Promise<T>;
    getCompanyInfo(): Promise<any>;
}
export declare function createQbClient(realmId: string): Promise<QbApiClient>;
