/**
 * PR Reviewer - GitHub Webhook Handler
 * Automatically triggers AI code reviews when pull requests are opened
 * 
 * Required Environment Variables:
 * - GITHUB_TOKEN: Personal Access Token for GitHub API authentication
 *   Must have 'repo' scope to post comments on pull requests
 * 
 * Usage:
 * 1. Set up GitHub webhook to point to this Val Town endpoint
 * 2. Configure webhook to send 'pull_request' events
 * 3. Ensure GITHUB_TOKEN environment variable is set
 * 
 * This handler triggers AI code reviews only when a new pull request is opened (action: "opened").
 * It intentionally ignores all other actions including code updates, comments, description changes,
 * label changes, etc. to avoid unnecessary API calls and comment spam.
 */

// ============================================================================
// TypeScript Interfaces
// ============================================================================

/**
 * GitHub user data structure
 */
export interface GitHubUser {
  login: string;
  type: string;
  id: number;
}

/**
 * GitHub webhook payload structure for pull request events
 */
export interface WebhookPayload {
  action: string;
  number: number;
  pull_request: {
    user: GitHubUser;
  };
  repository: {
    full_name: string;
  };
  sender: GitHubUser;
}



/**
 * Error response structure
 */
export interface ErrorResponse {
  error: string;
  message: string;
  timestamp: string;
}

// ============================================================================
// Core Interfaces
// ============================================================================



/**
 * Bot detection service interface
 */
export interface BotDetector {
  isBot(user: GitHubUser): boolean;
}

/**
 * Comment service interface for posting review comments
 */
export interface CommentService {
  postReviewComment(repo: string, prNumber: number): Promise<void>;
}

/**
 * GitHub API client interface
 */
export interface GitHubApiClient {
  postComment(repo: string, issueNumber: number, body: string): Promise<void>;
}

// ============================================================================
// Error Handling Framework
// ============================================================================

/**
 * Custom error class for webhook processing errors
 */
export class WebhookError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public errorCode: string = 'WEBHOOK_ERROR'
  ) {
    super(message);
    this.name = 'WebhookError';
  }
}

/**
 * Custom error class for GitHub API errors
 */
export class GitHubApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public errorCode: string = 'GITHUB_API_ERROR'
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

/**
 * Custom error class for configuration errors
 */
export class ConfigurationError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public errorCode: string = 'CONFIGURATION_ERROR'
  ) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Creates a standardized error response
 */
export function createErrorResponse(
  error: string,
  message: string,
  statusCode: number = 500
): Response {
  const errorResponse: ErrorResponse = {
    error,
    message,
    timestamp: new Date().toISOString()
  };

  return new Response(JSON.stringify(errorResponse), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

/**
 * Creates a success response
 */
export function createSuccessResponse(message: string = 'Success'): Response {
  return new Response(JSON.stringify({ 
    success: true, 
    message,
    timestamp: new Date().toISOString()
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

// ============================================================================
// Bot Detection Implementation
// ============================================================================

/**
 * Bot detection service implementation
 * Identifies bot users based on GitHub user type and login patterns
 */
export class BotDetector implements BotDetector {
  /**
   * Determines if a GitHub user is a bot
   * @param user - GitHub user object to check
   * @returns true if user is identified as a bot, false otherwise
   */
  isBot(user: GitHubUser): boolean {
    // Check if user type is "Bot" (Requirements 2.1)
    if (user.type === "Bot") {
      return true;
    }

    // Check if login ends with "[bot]" (Requirements 2.2)
    if (user.login.endsWith("[bot]")) {
      return true;
    }

    // If neither condition is met, classify as human user (Requirements 2.3)
    return false;
  }
}

// ============================================================================
// GitHub API Client Implementation
// ============================================================================

/**
 * GitHub API client implementation
 * Handles authentication and API requests to post comments
 */
export class GitHubApiClient implements GitHubApiClient {
  private token: string;

  constructor() {
    // @ts-ignore - Val Town environment variable access
    const token = Deno.env.get('GITHUB_TOKEN');
    if (!token) {
      throw new ConfigurationError(
        'GitHub token not found in environment variables',
        500,
        'MISSING_GITHUB_TOKEN'
      );
    }
    this.token = token;
  }

  /**
   * Posts a comment to a GitHub issue/PR
   * @param repo - Repository full name (e.g., "owner/repo")
   * @param issueNumber - Issue or PR number
   * @param body - Comment body text
   */
  async postComment(repo: string, issueNumber: number, body: string): Promise<void> {
    const url = `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'PR-Bot-Reviewer/1.0'
        },
        body: JSON.stringify({ body })
      });

      if (!response.ok) {
        const errorText = await response.text();
        
        // Log error details for troubleshooting (Requirement 5.2)
        console.error('GitHub API Error Details:', {
          url,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: errorText,
          timestamp: new Date().toISOString()
        });

        // Handle specific GitHub API error scenarios
        if (response.status === 401) {
          throw new GitHubApiError(
            'GitHub API authentication failed. Please check your GITHUB_TOKEN.',
            401,
            'GITHUB_AUTH_FAILED'
          );
        } else if (response.status === 403) {
          // Could be rate limiting or insufficient permissions
          if (errorText.includes('rate limit')) {
            throw new GitHubApiError(
              'GitHub API rate limit exceeded. Please try again later.',
              429,
              'GITHUB_RATE_LIMIT'
            );
          } else {
            throw new GitHubApiError(
              'GitHub API access forbidden. Please check repository permissions.',
              403,
              'GITHUB_FORBIDDEN'
            );
          }
        } else if (response.status === 404) {
          throw new GitHubApiError(
            `Repository or pull request not found: ${repo}#${issueNumber}`,
            404,
            'GITHUB_NOT_FOUND'
          );
        } else if (response.status >= 500) {
          throw new GitHubApiError(
            'GitHub API server error. Please try again later.',
            503,
            'GITHUB_SERVER_ERROR'
          );
        } else {
          throw new GitHubApiError(
            `GitHub API request failed: ${response.status} ${response.statusText} - ${errorText}`,
            response.status,
            'GITHUB_API_REQUEST_FAILED'
          );
        }
      }
    } catch (error) {
      // Handle network errors and timeouts (Requirement 4.4)
      if (error instanceof GitHubApiError) {
        throw error; // Re-throw our custom errors
      }
      
      // Log network error details
      console.error('GitHub API Network Error:', {
        url,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        throw new GitHubApiError(
          'GitHub API request timed out. Please try again later.',
          503,
          'GITHUB_TIMEOUT'
        );
      } else {
        throw new GitHubApiError(
          `Network error while contacting GitHub API: ${error.message}`,
          503,
          'GITHUB_NETWORK_ERROR'
        );
      }
    }
  }
}

// ============================================================================
// Comment Generation Service Implementation
// ============================================================================

/**
 * Comment service implementation for posting review comments
 * Generates standardized review trigger comments and posts them to GitHub PRs
 */
export class CommentService implements CommentService {
  private githubApiClient: GitHubApiClient;

  constructor(githubApiClient: GitHubApiClient) {
    this.githubApiClient = githubApiClient;
  }

  /**
   * Posts a standardized review comment to a pull request
   * @param repo - Repository full name (e.g., "owner/repo")
   * @param prNumber - Pull request number
   */
  async postReviewComment(repo: string, prNumber: number): Promise<void> {
    const commentBody = this.generateReviewComment();
    await this.githubApiClient.postComment(repo, prNumber, commentBody);
  }

  /**
   * Generates the standardized review comment text with all four review triggers
   * Each trigger is placed on a separate line as required
   * @returns The formatted comment body string
   */
  private generateReviewComment(): string {
    // Requirements 3.1, 3.2, 3.3, 3.4: Include all four review triggers
    // Requirement 3.5: Each trigger on a separate line
    return [
      "@coderabbitai review",
      "/gemini review", 
      "@cubic-dev-ai review",
      "@greptile review"
    ].join("\n");
  }
}

// ============================================================================
// Main HTTP Handler (Entry Point)
// ============================================================================

/**
 * Validates the structure and content of a webhook payload
 * @param payload - The parsed webhook payload to validate
 * @throws WebhookError if validation fails
 */
function validateWebhookPayload(payload: any): asserts payload is WebhookPayload {
  // Check if payload is an object
  if (!payload || typeof payload !== 'object') {
    throw new WebhookError(
      'Webhook payload must be a valid JSON object',
      400,
      'INVALID_PAYLOAD_TYPE'
    );
  }

  // Validate required top-level fields (Requirement 1.1)
  if (!payload.action || typeof payload.action !== 'string') {
    throw new WebhookError(
      'Webhook payload missing required field: action',
      400,
      'MISSING_ACTION'
    );
  }

  if (!payload.pull_request || typeof payload.pull_request !== 'object') {
    throw new WebhookError(
      'Webhook payload missing required field: pull_request',
      400,
      'MISSING_PULL_REQUEST'
    );
  }

  if (!payload.repository || typeof payload.repository !== 'object') {
    throw new WebhookError(
      'Webhook payload missing required field: repository',
      400,
      'MISSING_REPOSITORY'
    );
  }

  if (typeof payload.number !== 'number') {
    throw new WebhookError(
      'Webhook payload missing required field: number',
      400,
      'MISSING_NUMBER'
    );
  }

  // Validate pull_request structure
  if (!payload.pull_request || typeof payload.pull_request !== 'object') {
    throw new WebhookError(
      'Webhook payload missing required field: pull_request',
      400,
      'MISSING_PULL_REQUEST'
    );
  }

  // Validate sender structure (using sender instead of pull_request.user as per requirements)
  const sender = payload.sender;
  if (!sender || typeof sender !== 'object') {
    throw new WebhookError(
      'Webhook payload missing required field: sender',
      400,
      'MISSING_SENDER'
    );
  }

  if (!sender.login || typeof sender.login !== 'string') {
    throw new WebhookError(
      'Sender missing required field: login',
      400,
      'MISSING_SENDER_LOGIN'
    );
  }

  if (!sender.type || typeof sender.type !== 'string') {
    throw new WebhookError(
      'Sender missing required field: type',
      400,
      'MISSING_SENDER_TYPE'
    );
  }

  if (typeof sender.id !== 'number') {
    throw new WebhookError(
      'Sender missing required field: id',
      400,
      'MISSING_SENDER_ID'
    );
  }

  // Validate repository structure
  if (!payload.repository.full_name || typeof payload.repository.full_name !== 'string') {
    throw new WebhookError(
      'Repository missing required field: full_name',
      400,
      'MISSING_REPO_FULL_NAME'
    );
  }
}

/**
 * Main webhook handler function - Val Town HTTP trigger entry point
 * Processes GitHub webhook events and triggers AI code reviews for PRs
 */
export default async function(req: Request): Promise<Response> {
  try {
    // Validate HTTP method
    if (req.method !== 'POST') {
      return createErrorResponse(
        'METHOD_NOT_ALLOWED',
        'Only POST requests are supported',
        405
      );
    }

    // Validate Content-Type header
    const contentType = req.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return createErrorResponse(
        'INVALID_CONTENT_TYPE',
        'Content-Type must be application/json',
        400
      );
    }

    // Parse request body with enhanced error handling (Requirement 1.1, 5.1)
    let payload: WebhookPayload;
    try {
      const body = await req.text();
      
      // Check for empty body
      if (!body.trim()) {
        throw new WebhookError(
          'Request body is empty',
          400,
          'EMPTY_PAYLOAD'
        );
      }

      payload = JSON.parse(body);
    } catch (parseError) {
      // Log parsing error details for troubleshooting (Requirement 5.2)
      console.error('Payload parsing error:', {
        error: parseError.message,
        timestamp: new Date().toISOString()
      });

      if (parseError instanceof WebhookError) {
        throw parseError; // Re-throw our custom errors
      }

      throw new WebhookError(
        'Failed to parse webhook payload as JSON: ' + parseError.message,
        400,
        'INVALID_JSON'
      );
    }

    // Comprehensive payload validation (Requirement 5.1)
    try {
      validateWebhookPayload(payload);
    } catch (validationError) {
      // Log validation error details
      console.error('Payload validation error:', {
        error: validationError.message,
        payload: JSON.stringify(payload, null, 2),
        timestamp: new Date().toISOString()
      });
      throw validationError;
    }

    // Only trigger on 'opened' action to post review comments when a new PR is created
    // This prevents triggering on code updates, comments, description changes, etc.
    const ALLOWED_ACTIONS = ['opened'];
    
    // Only process if the action is in the allow-list
    if (!ALLOWED_ACTIONS.includes(payload.action)) {
      return createSuccessResponse(
        `Action '${payload.action}' is not in the allow-list. No review comment posted.`
      );
    }

    // Initialize GitHub API client and comment service with error handling (Requirement 4.2)
    let githubApiClient: GitHubApiClient;
    let commentService: CommentService;
    
    try {
      githubApiClient = new GitHubApiClient();
      commentService = new CommentService(githubApiClient);
    } catch (configError) {
      // Log configuration error details
      console.error('Configuration error:', {
        error: configError.message,
        timestamp: new Date().toISOString()
      });
      throw configError;
    }

    // Post review comment for PR (Requirement 1.4)
    try {
      await commentService.postReviewComment(
        payload.repository.full_name,
        payload.number
      );
    } catch (commentError) {
      // Log comment posting error details (Requirement 5.2)
      console.error('Comment posting error:', {
        repo: payload.repository.full_name,
        prNumber: payload.number,
        error: commentError.message,
        timestamp: new Date().toISOString()
      });
      throw commentError;
    }

    // Return success response (Requirement 1.5, 5.3)
    return createSuccessResponse(
      `Review comment posted successfully for PR #${payload.number} by ${payload.sender.login}`
    );

  } catch (error) {
    // Enhanced error handling and logging (Requirement 5.5, 5.2)
    console.error('Webhook handler error:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      url: req.url,
      method: req.method,
      headers: Object.fromEntries(req.headers.entries())
    });
    
    // Handle known error types with appropriate status codes (Requirement 5.4)
    if (error instanceof WebhookError || error instanceof GitHubApiError || error instanceof ConfigurationError) {
      return createErrorResponse(
        error.errorCode,
        error.message,
        error.statusCode
      );
    }

    // Handle unexpected errors gracefully without crashing (Requirement 5.5)
    return createErrorResponse(
      'INTERNAL_ERROR',
      'An unexpected error occurred while processing the webhook',
      500
    );
  }
}