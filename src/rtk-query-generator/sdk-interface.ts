export const defaultSdkInterface = `
import type { BaseQueryApi } from "@reduxjs/toolkit/dist/query/baseQueryTypes";
import type { BaseQueryFn } from "@reduxjs/toolkit/query";

export type BaseRequestArgs = {
  body: unknown;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query: Record<string, any>;
  route: string;
};

type RequestOptions = object;
type Metadata = object;

export type BaseRequestFn<Result = unknown> = BaseQueryFn<
  BaseRequestArgs,
  Result,
  RequestError,
  RequestOptions,
  Metadata
>;

export type BaseResponse<Result, Error, Metadata> =
  | {
      data?: undefined;
      error: Error;
      meta?: Metadata;
    }
  | {
      data: Result;
      error?: undefined;
      meta?: Metadata;
    };

export const getBaseUrl = (): string => {
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const port = window.location.port ? ":" + window.location.port : "";
  const basePath = "/api"; // Change or configure this to suite your needs

  return protocol + "//" + hostname + port + basePath;
};

export const BaseRequest = async <Result>(
  { body, method, query, route }: BaseRequestArgs,
  _api: BaseQueryApi,
  _options: RequestOptions
): Promise<BaseResponse<Result, RequestError, Metadata>> => {
  const baseUrl = getBaseUrl();
  const url = new URL(baseUrl + route);

  const fetchArgs: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };

  const httpMetadata: HTTPMetadata = {
    req: {
      body,
      method,
      query,
      url: url.toString(),
    },
  };

  const errorResult = (type: RequestErrorType, cause?: unknown) => ({
    data: undefined,
    meta: {},
    error: new RequestError({ cause, http: httpMetadata, type }),
  });

  try {
    for (const key in query) {
      const value = query[key];
      const valueType = typeof value;
      const isUndefined = value === undefined;
      const isNull = value === null;
      const isObject = valueType === "object" && !isNull; // typeof null => "object" :'(

      if (isUndefined) {
        continue; // Don't send undefined query params (do send nulls though!)
      }

      if (isObject) {
        url.searchParams.append(key, JSON.stringify(query[key])); // Stringify objects and arrays
      } else {
        url.searchParams.append(key, query[key]); // Primitives: string, number, boolean, null
      }
    }

    if (method !== "GET" && body) {
      fetchArgs.body = JSON.stringify(body);
    }
  } catch (cause) {
    return errorResult(RequestErrorType.PARSING_ERROR, cause);
  }

  let response: Response;
  let responseText: string;
  try {
    response = await fetch(url.toString(), fetchArgs);
    responseText = await response.text();
  } catch (cause) {
    return errorResult(RequestErrorType.FETCH_ERROR, cause);
  }

  httpMetadata.res = {
    status: response.status,
    statusDescription: response.statusText,
    text: responseText,
  };

  if (RequestError.statusCodeIsError(response.status)) {
    return errorResult(RequestErrorType.API_ERROR);
  }

  let data: Result;
  try {
    data = JSON.parse(responseText);
  } catch (cause) {
    return errorResult(RequestErrorType.PARSING_ERROR, cause);
  }

  return { data, meta: {}, error: undefined };
};

export enum RequestErrorType {
  API_ERROR = "API_ERROR",
  FETCH_ERROR = "FETCH_ERROR",
  PARSING_ERROR = "PARSING_ERROR",
  // TIMEOUT_ERROR = "TIMEOUT_ERROR", TODO: Implement request timeouts
}

export type RequestErrorCause = {
  message: string;
  source: Error | unknown;
  stack?: string;
};

export type HTTPMetadata = {
  req: {
    body?: unknown;
    method: string;
    query?: Record<string, any>;
    url: string;
  };
  res?: {
    status: number;
    statusDescription: string;
    text: string;
  };
};

export type RequestErrorParams = {
  cause?: unknown;
  http: HTTPMetadata;
  type: RequestErrorType;
};

export class RequestError extends Error {
  public static readonly DEFAULT_USER_MESSAGE: "An unexpected error occurred. We're looking into it!";

  public readonly type: RequestErrorType;
  public readonly userMessage: string;
  public readonly http: HTTPMetadata;
  public readonly cause?: RequestErrorCause;

  constructor(params: RequestErrorParams) {
    const cause = RequestError.parseCause(params.cause);
    const userMessage = RequestError.parseUserMessage(params);

    super(userMessage);

    this.type = params.type;
    this.userMessage = userMessage;
    this.http = params.http;
    this.cause = cause;
  }

  toJSON() {
    return {
      type: this.type,
      userMessage: this.userMessage,
      cause: this.cause,
      stack: this.stack,
      http: this.http,
    };
  }

  toString() {
    return JSON.stringify(this, null, 2);
  }

  public static parseCause(cause: unknown): RequestErrorCause | undefined {
    if (cause === undefined || cause === null) {
      return undefined;
    }

    if (cause instanceof Error) {
      return {
        message: cause.message,
        source: cause,
        stack: cause.stack,
      };
    }

    if (typeof cause === "string") {
      return {
        message: cause,
        source: cause,
      };
    }

    try {
      return {
        message: JSON.stringify(cause),
        source: cause,
      };
    } catch (e) {
      return {
        message: "Unknown error is not serializable",
        source: cause,
      };
    }
  }

  public static parseUserMessage({ http, type }: RequestErrorParams): string {
    let userMessage = RequestError.DEFAULT_USER_MESSAGE;

    if (type === RequestErrorType.API_ERROR && http.res) {
      try {
        const responseBody = JSON.parse(http.res.text);
        if (
          responseBody &&
          typeof responseBody.message === "string" &&
          responseBody.message.length > 0
        ) {
          userMessage = responseBody.message;
        }
      } catch (e) {
        console.warn("Failed to parse API error response body", http.res.text);
      }
    }

    return userMessage;
  }

  public static statusCodeIsError(statusCode: number): boolean {
    return statusCode >= 400;
  }
}

`.trim()
