import { sign } from 'hono/jwt';

// we created this because `google-auth-library` does not support Cloudflare Workers :(
// ref: https://developers.google.com/identity/protocols/oauth2/service-account#httprest

interface GooglePlayConfig {
  email: string;
  key: string;
  scopes: string[];
}

export class GooglePlay {
  private email: string;
  private key: string;
  private scopes: string[];
  private accessToken: string | null = null;
  private tokenExpiration = 0;

  constructor(config: GooglePlayConfig) {
    this.email = config.email;
    this.key = config.key;
    this.scopes = config.scopes;
  }

  /**
   * Creates a JWT for Google API authentication
   * @returns The signed JWT
   */
  private async createJWT(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const oneHour = 60 * 60;

    const payload = {
      iss: this.email,
      scope: this.scopes.join(' '),
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + oneHour,
      iat: now
    };

    return await sign(payload, this.key, 'RS256');
  }

  /**
   * Gets an access token from Google's OAuth server
   * @returns Access token
   */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();

    // Return cached token if it's still valid (with 5 minute buffer)
    if (this.accessToken && now < this.tokenExpiration - 5 * 60 * 1000) {
      return this.accessToken;
    }

    const jwt = await this.createJWT();
    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get access token: ${error}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    if (typeof data.access_token !== 'string') {
      throw new Error('Missing access token');
    }

    this.accessToken = data.access_token;

    // Set token expiration (subtract 5 minutes for safety)
    this.tokenExpiration = now + data.expires_in * 1000;

    return this.accessToken;
  }

  /**
   * Makes a request to the Google Play API
   * @param url The API endpoint URL
   * @param options Additional fetch options
   * @returns Response from the API
   */
  async request<T = any>(url: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();

    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Play API request failed: ${errorText}`);
    }

    return response.json();
  }
}
