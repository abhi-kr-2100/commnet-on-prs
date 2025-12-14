# Design Document: PR Bot Reviewer

## Overview

The PR Bot Reviewer is a Val Town HTTP webhook handler that automatically triggers AI code reviews when bots open pull requests. The system receives GitHub webhook events, identifies bot users, and posts standardized comments to invoke multiple AI review services.

## Architecture

The system follows a simple event-driven architecture:

```
GitHub → Webhook → Val Town Handler → GitHub API → PR Comment
```

**Components:**
- **Webhook Receiver**: HTTP endpoint that receives GitHub webhook payloads
- **Bot Detector**: Logic to identify bot users from GitHub user data
- **Comment Generator**: Creates standardized review trigger comments
- **GitHub API Client**: Handles authentication and API requests to post comments

## Components and Interfaces

### WebhookHandler
```typescript
interface WebhookHandler {
  handleRequest(request: Request): Promise<Response>
}
```

**Responsibilities:**
- Parse incoming webhook payloads
- Validate payload structure
- Coordinate bot detection and comment posting
- Handle errors and return appropriate responses

### BotDetector
```typescript
interface BotDetector {
  isBot(user: GitHubUser): boolean
}

interface GitHubUser {
  login: string
  type: string
  id: number
}
```

**Responsibilities:**
- Identify bot users based on type field
- Identify bot users based on login pattern
- Return boolean classification

### CommentService
```typescript
interface CommentService {
  postReviewComment(repo: string, prNumber: number): Promise<void>
}
```

**Responsibilities:**
- Generate standardized review comment text
- Authenticate with GitHub API
- Post comments to pull requests
- Handle API errors

### GitHubApiClient
```typescript
interface GitHubApiClient {
  postComment(repo: string, issueNumber: number, body: string): Promise<void>
}
```

**Responsibilities:**
- Handle GitHub API authentication
- Make HTTP requests to GitHub API
- Parse API responses and handle errors

## Data Models

### WebhookPayload
```typescript
interface WebhookPayload {
  action: string
  number: number
  pull_request: {
    id: number
    state: string
    title: string
    user: GitHubUser
  }
  repository: {
    id: number
    name: string
    full_name: string
  }
  sender: GitHubUser
}
```

### ReviewComment
```typescript
interface ReviewComment {
  body: string
}
```

The comment body will contain:
```
@coderabbitai review
/gemini review
@cubic-dev-ai review
@greptile review
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

After reviewing all properties identified in the prework, several can be consolidated:

- Properties 3.1-3.4 (individual review service inclusion) can be combined into one comprehensive comment content property
- Properties 2.1-2.3 (bot detection variants) can be combined into one comprehensive bot detection property  
- Properties 4.1 and 4.3 (authentication mechanisms) can be combined into one authentication property
- Properties 5.3-5.4 (response status codes) can be combined into one response handling property

### Core Properties

**Property 1: Webhook payload validation**
*For any* incoming HTTP request, if the payload contains valid GitHub webhook structure with action "opened", then the handler should extract PR information successfully
**Validates: Requirements 1.1, 1.2**

**Property 2: Bot detection accuracy**
*For any* GitHub user, the bot detector should classify them as a bot if and only if their type is "Bot" or their login ends with "[bot]"
**Validates: Requirements 2.1, 2.2, 2.3**

**Property 3: Selective comment posting**
*For any* valid webhook payload, comments should be posted if and only if the action is "opened" and the PR opener is a bot
**Validates: Requirements 1.3, 2.4**

**Property 4: Complete review comment content**
*For any* generated review comment, the body should contain all four review triggers: "@coderabbitai review", "/gemini review", "@cubic-dev-ai review", and "@greptile review", each on separate lines
**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

**Property 5: GitHub API authentication**
*For any* GitHub API request, the authorization header should be properly set using the Personal Access Token from environment variables
**Validates: Requirements 4.1, 4.3**

**Property 6: Error handling resilience**
*For any* malformed input or API failure, the system should return appropriate HTTP error status without crashing
**Validates: Requirements 4.2, 4.4, 5.1, 5.2, 5.4, 5.5**

**Property 7: Success response consistency**
*For any* successful processing flow, the handler should return HTTP 200 status
**Validates: Requirements 1.5, 5.3**

## Error Handling

The system implements comprehensive error handling at multiple levels:

**Input Validation Errors:**
- Malformed JSON payloads → 400 Bad Request
- Missing required fields → 400 Bad Request
- Invalid webhook signatures → 401 Unauthorized

**Configuration Errors:**
- Missing GitHub token → 500 Internal Server Error
- Invalid token → 401 Unauthorized

**API Errors:**
- GitHub API rate limits → 429 Too Many Requests
- Network timeouts → 503 Service Unavailable
- Authentication failures → 401 Unauthorized

**Error Response Format:**
```typescript
interface ErrorResponse {
  error: string
  message: string
  timestamp: string
}
```

## Testing Strategy

### Dual Testing Approach

The system will use both unit testing and property-based testing to ensure comprehensive coverage:

**Unit Tests:**
- Specific webhook payload examples
- Known bot user patterns
- API error scenarios
- Configuration edge cases

**Property-Based Tests:**
- Random webhook payload generation and validation
- Random user data for bot detection testing
- Various API response scenarios
- Error condition simulation

### Property-Based Testing Framework

**Framework:** fast-check (JavaScript/TypeScript property testing library)
**Configuration:** Minimum 100 iterations per property test
**Test Tagging:** Each property test will include a comment referencing the design document property

### Test Categories

**Integration Tests:**
- End-to-end webhook processing
- GitHub API interaction
- Error propagation

**Unit Tests:**
- Bot detection logic
- Comment generation
- Payload parsing
- Authentication handling

**Property Tests:**
- Input validation across all possible payloads
- Bot detection across all user types
- Comment content consistency
- Error handling robustness