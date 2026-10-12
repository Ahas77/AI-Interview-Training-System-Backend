# AI Interview Training System Backend

This backend is a Node.js and Express API for an AI-powered interview training system. It currently supports user authentication, CV upload, CV text extraction, AI-based resume parsing, interview-context saving, AI-generated HR interview questions, interview session tracking, and question/answer logging.

The main business purpose of this service is to let a candidate register, upload a CV, convert that CV into structured professional data, choose a target company/job role/expertise level, and then run a short personalized HR interview practice session based on that candidate's real CV content.

## Current Implementation Status

Implemented so far:

- Express API server with CORS, JSON body parsing, URL-encoded body parsing, and route mounting.
- MySQL database connection pool using `mysql2/promise`.
- Automatic database and table initialization on server startup.
- User registration with validation, duplicate checks, password hashing, and MySQL persistence.
- User login using email or mobile number.
- JWT authentication middleware for protected routes.
- Profile fetching, profile update, password reset, and logout endpoint.
- CV upload using `multer`.
- File validation for PDF, DOC, and DOCX uploads.
- Local upload storage under `uploads/cvs`.
- CV text extraction from PDF using `pdf-parse`.
- PDF text extraction fallback using `pdfjs-dist`.
- OCR fallback for scanned PDFs using `tesseract.js`.
- DOC/DOCX raw text extraction using `mammoth`.
- AI resume parsing into a normalized IT/software-engineering-focused JSON structure.
- Heuristic resume parser fallback when AI output is unavailable or invalid.
- CV analysis persistence in `cv_analysis`.
- Latest CV lookup and CV lookup by ID for authenticated users.
- Interview context saving: target company, job role, and expertise level.
- Interview session creation with a fixed 5-question flow.
- AI-generated HR interview questions based on CV data and previous answers.
- Q&A logging in `interview_qa_logs`.
- Interview completion when all questions are answered.
- AI provider abstraction supporting Groq, xAI, Gemini, OpenAI-style keys, and Pollinations fallback.

Not implemented yet:

- Automated test suite. The current `npm test` script is still a placeholder.
- Admin dashboard APIs.
- Interview score/evaluation logic.
- Audio recording or speech-to-text answer processing.
- Text-to-speech response generation.
- Refresh-token flow or server-side token revocation.
- File deletion/cleanup for old uploaded CVs.
- Cloud storage for uploaded CVs.
- Role-based authorization beyond storing `role` in the user record.
- Pagination/list endpoint exposed for all CV analyses, although the model has `getUserCVAnalyses`.
- Frontend documentation in this README. This file documents the backend only.

## Tech Stack

- Runtime: Node.js
- API framework: Express 5
- Database: MySQL
- Database driver: `mysql2/promise`
- Authentication: JWT using `jsonwebtoken`
- Password hashing: `bcryptjs`
- Upload handling: `multer`
- PDF text extraction: `pdf-parse`, `pdfjs-dist`
- DOC/DOCX extraction: `mammoth`
- OCR: `tesseract.js`
- AI HTTP calls: `axios`
- Environment loading: `dotenv`
- Development runner: `nodemon`

## Project Structure

```text
AI-Interview-Training-System-Backend/
  index.js
  package.json
  package-lock.json
  scratch_test.js
  eng.traineddata
  uploads/
    cvs/
  src/
    config/
      db.js
    controllers/
      authController.js
      cvController.js
      interviewController.js
    middleware/
      authMiddleware.js
      cvUploadMiddleware.js
    models/
      userModel.js
      cvModel.js
      interviewModel.js
    routes/
      authRoutes.js
      cvRoutes.js
      interviewRoutes.js
    services/
      ai/
        aiProvider.js
      aiResumeParser.js
      documentTextExtractor.js
      hrAiAgentService.js
      ocrService.js
```

## How The Application Starts

The entry point is `index.js`.

Startup flow:

1. Loads environment variables with `dotenv`.
2. Creates an Express app.
3. Adds middleware:
   - `cors()`
   - `express.json()`
   - `express.urlencoded({ extended: true })`
4. Mounts routes:
   - `/api` for authentication and profile routes.
   - `/api/cv` for CV upload and CV analysis routes.
   - `/api/interview` for interview session routes.
5. Adds a root health endpoint at `GET /`.
6. Calls `initDB()`.
7. Starts the HTTP server on `PORT` or `8000`.

The database initialization happens before the server starts listening, so the API is designed to be usable without manually creating tables first.

## Environment Variables

Create a `.env` file in the backend root.

Example:

```env
PORT=8000

DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_PORT=3306
DB_NAME=interview_db

JWT_SECRET=replace_with_a_long_random_secret

GROQ_API_KEY=
XAI_API_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=
```

Only one AI key is required if you want configured AI calls. The provider checks keys in this order:

1. `GROQ_API_KEY`
2. `XAI_API_KEY`
3. `GEMINI_API_KEY`
4. `OPENAI_API_KEY`

If no supported key works, the system attempts to use the free Pollinations text endpoint as a fallback.

Important security note: the code currently falls back to `default_secret_key` if `JWT_SECRET` is missing. For real deployment, always set a strong `JWT_SECRET`.

## Installation And Running

Install dependencies:

```bash
npm install
```

Run in development mode:

```bash
npm run dev
```

Run in production-style mode:

```bash
npm start
```

Default API base URL:

```text
http://localhost:8000
```

Health check:

```http
GET /
```

Response:

```json
{
  "status": "ok",
  "message": "Backend API Service is running."
}
```

## Database Design

The database is initialized in `src/config/db.js`.

The system creates the database named by `DB_NAME`, or `interview_db` by default.

### `users`

Stores registered users and authentication data.

Main fields:

- `id`: Primary key.
- `first_name`: Required first name.
- `last_name`: Required last name.
- `email`: Required unique email.
- `mobile_contact_number`: Required unique mobile number.
- `nic`: Required unique NIC/passport value.
- `address`: Optional address.
- `date_of_birth`: Optional date of birth.
- `gender`: User gender, default `Male`.
- `password`: Hashed password.
- `role`: Defaults to `user`.
- `avatar`: Optional avatar path/URL.
- `created_at`: Creation timestamp.
- `updated_at`: Auto-updated timestamp.

Business role:

- Owns CV analyses.
- Owns interview sessions.
- Controls data isolation through `user_id`.

### `cv_analysis`

Stores uploaded CV files, extracted text, parsed AI data, and interview targeting context.

Main fields:

- `id`: Primary key.
- `user_id`: Owner user ID.
- `file_name`: Original uploaded filename.
- `file_path`: Saved local filename.
- `raw_text`: Extracted CV text.
- `parsed_data`: Full AI/heuristic parsed JSON.
- `candidate_name`: Extracted candidate name.
- `email`: Extracted candidate email.
- `phone`: Extracted candidate phone.
- `experience_years`: Extracted/estimated experience.
- `skills`: JSON list of skills.
- `suggested_role`: First suggested role from parsed CV.
- `suggested_level`: Suggested expertise level.
- `target_company`: Company selected for interview practice.
- `target_job_role`: Job role selected for interview practice.
- `target_expertise_level`: Expertise level selected for interview practice.
- `status`: CV/interview-context status. Currently uses values like `draft`, `uploaded`, and `started`.
- `created_at`: Creation timestamp.
- `updated_at`: Auto-updated timestamp.

Business role:

- Keeps the CV analysis result reusable.
- Provides context for generating personalized interview questions.
- Allows the frontend to continue from the latest uploaded CV.

### `interview_sessions`

Stores one interview practice session.

Main fields:

- `id`: Primary key.
- `user_id`: Owner user ID.
- `cv_id`: Optional linked CV analysis.
- `target_company`: Company context for questions.
- `job_role`: Target job role.
- `expertise_level`: Target seniority/expertise level.
- `status`: `in_progress` or `completed`.
- `total_questions`: Defaults to `5`.
- `current_question_index`: Starts at `1`.
- `created_at`: Creation timestamp.
- `completed_at`: Set when session is completed.

Business role:

- Tracks progress through the 5-question interview.
- Links the interview to the CV that generated the personalized context.

### `interview_qa_logs`

Stores every generated interview question and the candidate answer.

Main fields:

- `id`: Primary key.
- `session_id`: Linked interview session.
- `question_number`: Question order.
- `question_text`: AI-generated question.
- `user_answer_text`: Candidate answer.
- `created_at`: Creation timestamp.

Business role:

- Preserves interview history.
- Feeds previous Q&A back into the AI prompt so later questions avoid repetition and can follow the conversation.

## Main Business Flow

### 1. User Registration

Route:

```http
POST /api/register
```

Controller:

```text
authController.register
```

Model:

```text
User.createUser
```

What happens:

1. Request body is validated.
2. Required fields are checked:
   - `first_name`
   - `last_name`
   - `email`
   - `mobile_contact_number`
   - `nic`
   - `password`
   - `password_confirmation`
3. Password must be at least 6 characters.
4. Password and confirmation must match.
5. Email, mobile number, and NIC are checked for duplicates.
6. Password is hashed using bcrypt with salt rounds `10`.
7. User is inserted into MySQL.
8. Response returns basic user details.

Why it works this way:

- Duplicate checks prevent multiple accounts with the same identity details.
- Password hashing protects stored credentials.
- The response does not return the hashed password.

### 2. Login

Route:

```http
POST /api/login
```

Controller:

```text
authController.login
```

What happens:

1. The request sends `type`, `value`, and `password`.
2. If `type` is `mobile_contact_number`, the system searches by mobile.
3. Otherwise, it searches by email.
4. If the first lookup fails, it falls back and tries both email and mobile.
5. Password is compared with bcrypt.
6. A JWT token is generated for 7 days.
7. Response returns token and basic user data.

JWT payload:

```json
{
  "id": "user id",
  "email": "user email",
  "role": "user role"
}
```

Why it works this way:

- The frontend can let users login with email or mobile number.
- JWT makes protected API calls stateless.

Current limitation:

- The JWT only includes `id`, `email`, and `role`. Some interview code attempts to build a full name from `req.user.first_name` and `req.user.last_name`, but those fields are not in the JWT. Therefore, interview question generation usually falls back to the CV candidate name unless the frontend passes CV parsed data.

### 3. Protected Route Authentication

Middleware:

```text
verifyToken
```

Expected header:

```http
Authorization: Bearer <jwt_token>
```

What happens:

1. Checks that the header exists.
2. Checks that it starts with `Bearer `.
3. Verifies the token using `JWT_SECRET`.
4. Stores decoded token data in `req.user`.
5. Allows the request to continue.

Why it works this way:

- Every protected controller can trust `req.user.id` for data ownership checks.
- CV and interview records are always queried by both record ID and `user_id`.

### 4. CV Upload And Analysis

Route:

```http
POST /api/cv/upload
```

Auth:

```text
Required
```

Upload field name:

```text
cv
```

Controller:

```text
cvController.uploadAndAnalyzeCV
```

Middleware:

```text
verifyToken -> cvUploadMiddleware
```

Services:

```text
extractTextFromDocument -> parseResume
```

Model:

```text
CVModel.saveCVAnalysis
```

What happens:

1. JWT token is verified.
2. Uploaded file is validated.
3. File is saved to `uploads/cvs`.
4. Text is extracted from the document.
5. Extracted text is validated for non-empty content.
6. Resume text is sent to the AI resume parser.
7. Parsed data is normalized into a consistent schema.
8. Important top-level fields are copied into MySQL columns.
9. Full parsed JSON and raw extracted text are saved.
10. API returns the saved analysis data to the frontend.

Allowed file extensions:

- `.pdf`
- `.docx`
- `.doc`

Allowed MIME types:

- `application/pdf`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `application/msword`
- `application/octet-stream`

Maximum file size:

```text
10 MB
```

Saved filename format:

```text
cv_<userId>_<timestamp>_<randomString>.<extension>
```

Why it works this way:

- The original filename is preserved in the database for display.
- The saved filename is made unique to avoid collisions.
- Uploads are stored outside a public static route, so files are not automatically exposed by Express.
- Both raw text and structured JSON are stored because later interview generation needs detailed CV context.

### 5. CV Text Extraction Logic

Service:

```text
src/services/documentTextExtractor.js
```

PDF extraction order:

1. Try `pdf-parse`.
2. If text is insufficient, try `pdfjs-dist`.
3. If text is still insufficient, run OCR with Tesseract.

DOC/DOCX extraction:

1. Use Mammoth's `extractRawText`.

Text quality check:

```text
At least 50 trimmed characters and at least 10 words.
```

Extraction methods returned:

- `pdf-text`
- `pdf-ocr`
- `docx-text`

Why it works this way:

- Some PDFs contain real embedded text.
- Some PDFs contain text items that one parser can read better than another.
- Some PDFs are scanned images and require OCR.
- DOC/DOCX files need a separate parser.

Current OCR limitation:

- `ocrService.js` tries to extract embedded image data from PDF pages and run Tesseract on those image buffers. This can work for some scanned PDFs, but scanned PDF rendering quality may vary depending on how images are embedded.

### 6. AI Resume Parsing

Service:

```text
src/services/aiResumeParser.js
```

Provider:

```text
src/services/ai/aiProvider.js
```

What the parser extracts:

- Candidate profile:
  - full name
  - email
  - phone
  - location
  - LinkedIn
  - GitHub
  - portfolio
- Professional summary
- Skills
- Technical skills
- Soft skills
- Tools and frameworks
- Databases and cloud
- Experience years
- Expertise level
- Suggested job roles
- Education
- Work experience
- Projects
- Certifications
- Languages
- Achievements
- Publications
- Volunteer work
- Custom sections
- Keywords

The AI system prompt is specialized for IT and software engineering CVs. It asks the model not to hallucinate and to return strict JSON.

Supported expertise levels:

- `Intern`
- `Junior`
- `Mid-Level`
- `Senior`
- `Lead`
- `Manager`
- `null`

Why it works this way:

- The application is not a general HR system. It is focused on software/IT interview practice.
- Structured parsing lets the interview question generator reference actual skills, projects, and experience.
- Normalized output makes frontend rendering easier because arrays and missing fields are predictable.

Fallback behavior:

If AI fails, returns invalid JSON, or is unavailable, the service uses `heuristicFallbackParse`.

The heuristic fallback detects:

- Email with regex.
- Sri Lankan-style mobile numbers and general phone-like values.
- Candidate name from common CV labels or early title-case lines.
- Location from common city/address patterns.
- LinkedIn, GitHub, and portfolio links.
- Education from common degree/institution keywords.
- Projects from simple project-section patterns.
- Known software technologies.
- Suggested job roles based on detected keywords.
- Basic expertise level from seniority keywords.

Why fallback exists:

- CV upload should still return useful data even when the AI provider is down.
- It prevents the whole workflow from failing just because the LLM response is unavailable or malformed.

### 7. Saving Interview Context

Route:

```http
POST /api/cv/start-interview
```

Controller:

```text
cvController.saveInterviewContext
```

What it saves:

- Target company
- Target job role
- Target expertise level

Required:

- `jobRole`
- `expertiseLevel`

Optional:

- `company`
- `cvId`
- `cvData`

How it behaves:

- If `cvData` is passed, the backend inserts a new complete CV analysis record with the selected interview context.
- If `cvId` is passed, the backend updates that CV record.
- If no `cvId` is passed, it updates the latest CV for the user.
- The CV status becomes `started`.

Why it works this way:

- The frontend may start an interview immediately after upload before re-fetching the saved CV.
- The backend supports both fresh in-memory CV data and already-saved CV records.

Important distinction:

- `/api/cv/start-interview` saves CV interview context.
- `/api/interview/start` creates the actual interview session and first question.

### 8. Starting An Interview Session

Route:

```http
POST /api/interview/start
```

Controller:

```text
interviewController.startSession
```

Models:

```text
CVModel
InterviewModel
```

AI service:

```text
HRAiAgentService.generateNextQuestion
```

What happens:

1. JWT token is verified.
2. Request may include `cvId`, `cvData`, `company`, `jobRole`, and `expertiseLevel`.
3. Backend ensures a usable CV record exists:
   - updates existing CV context if `cvId` or `cvData.id` exists.
   - inserts a CV record if only unsaved `cvData` exists.
   - falls back to the latest CV if no CV is passed.
4. Creates a new row in `interview_sessions`.
5. Sets `total_questions` to `5`.
6. Sets `current_question_index` to `1`.
7. Generates question 1 using the HR AI agent.
8. Logs question 1 in `interview_qa_logs`.
9. Returns session ID and first question.

Default values:

- `jobRole`: `Software Engineer`
- `company`: `Tech Company`
- `expertiseLevel`: `Intermediate`
- `totalQuestions`: `5`

Why it works this way:

- The session is saved before generating the question so the interview has a persistent state.
- The first question is logged immediately, allowing the frontend to reload the session later.
- The session is connected to CV data when available, but the system can still start with defaults.

### 9. AI HR Question Generation

Service:

```text
src/services/hrAiAgentService.js
```

Question logic:

- Question 1:
  - Uses time-of-day greeting.
  - Uses candidate name if available.
  - Asks the candidate to introduce themself.
  - Mentions the target role and company.
- Questions 2 to 5:
  - Avoid greetings.
  - Ask deeper CV-based HR questions.
  - Reference actual projects, skills, work history, education, or previous answers.
  - Avoid repeating previous questions.

Prompt context includes:

- Candidate full name.
- Current time greeting.
- Target job role.
- Target company.
- Expertise level.
- Professional summary.
- Skills and tech stack.
- Work history.
- Projects.
- Education.
- Raw CV snippet.
- Previous Q&A history.

Why it works this way:

- Question 1 needs to sound like the beginning of a live interview.
- Later questions should become specific to the candidate instead of generic.
- Previous Q&A history helps the AI avoid repeating itself.
- The output is kept to 1 or 2 sentences because it is suitable for spoken interview practice or future TTS.

Fallback behavior:

- If the configured AI provider fails, it tries the free LLM fallback.
- If all AI calls fail:
  - Question 1 returns a deterministic introduction question.
  - Later questions return a generic technical-project question.

### 10. Submitting Interview Answers

Route:

```http
POST /api/interview/submit-answer
```

Controller:

```text
interviewController.submitAnswer
```

Required body fields:

- `sessionId`
- `qaId`

Optional:

- `userAnswerText`

What happens:

1. JWT token is verified.
2. Session is loaded by `sessionId` and `req.user.id`.
3. The current answer is saved to the matching Q&A log.
4. If `current_question_index >= total_questions`, the session is marked completed.
5. Otherwise, `current_question_index` increments by 1.
6. All previous Q&A logs are loaded.
7. Previous Q&A is passed into the AI prompt.
8. The next question is generated.
9. The next question is saved in `interview_qa_logs`.
10. API returns the next question.

Why it works this way:

- The backend is stateful about interview progress.
- The frontend does not need to calculate the next question number.
- Every answer is saved before the next question is generated.
- Later questions can use previous answers as context.

Current security/validation note:

- `saveAnswer(qaId, userAnswerText)` updates by Q&A ID only. The controller checks session ownership, but it does not verify that the submitted `qaId` belongs to that session before updating. A future improvement should update using both `qaId` and `sessionId`.

### 11. Completing An Interview

Routes:

```http
POST /api/interview/complete
```

Automatic completion:

- Also happens in `/api/interview/submit-answer` when the current question index reaches total questions.

What happens:

- Session status becomes `completed`.
- `completed_at` is set to `NOW()`.

Why it works this way:

- The frontend can either let the normal answer flow complete the interview or explicitly mark a session as complete.

## API Reference

### Auth Routes

Base route:

```text
/api
```

#### Register

```http
POST /api/register
```

Body:

```json
{
  "first_name": "John",
  "last_name": "Doe",
  "email": "john@example.com",
  "mobile_contact_number": "0712345678",
  "address": "Colombo",
  "nic": "123456789V",
  "dateOfBirth": "2000-01-01",
  "gender": "Male",
  "password": "secret123",
  "password_confirmation": "secret123"
}
```

Success response:

```json
{
  "success": true,
  "message": "Account created successfully!",
  "data": {
    "id": 1,
    "first_name": "John",
    "last_name": "Doe",
    "email": "john@example.com"
  }
}
```

#### Login

```http
POST /api/login
```

Body:

```json
{
  "type": "email",
  "value": "john@example.com",
  "password": "secret123"
}
```

Or:

```json
{
  "type": "mobile_contact_number",
  "value": "0712345678",
  "password": "secret123"
}
```

Success response:

```json
{
  "success": true,
  "message": "Signed in successfully!",
  "token": "jwt_token_here",
  "data": {
    "user_id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user",
    "avatar": ""
  }
}
```

#### Logout

```http
POST /api/logout
```

Current behavior:

- Returns success only.
- Does not invalidate the JWT server-side.

#### Get Profile

```http
GET /api/me
GET /api/profile
```

Auth:

```text
Required
```

Response data includes:

- username
- first name
- last name
- email
- mobile contact number
- date of birth
- gender
- status
- avatar
- QR code placeholder

#### Update Profile

```http
POST /api/update_profile
```

Auth:

```text
Required
```

Body:

```json
{
  "first_name": "John",
  "last_name": "Doe",
  "mobile_contact_number": "0712345678",
  "dateOfBirth": "2000-01-01",
  "gender": "Male"
}
```

Current note:

- The controller receives `gender`, but the SQL update currently does not update the `gender` column.

#### Reset Profile Password

```http
POST /api/profile-reset-password
```

Auth:

```text
Required
```

Body:

```json
{
  "new_password": "newsecret123",
  "confirm_password": "newsecret123"
}
```

### CV Routes

Base route:

```text
/api/cv
```

All CV routes require JWT authentication.

#### Upload And Analyze CV

```http
POST /api/cv/upload
```

Content type:

```text
multipart/form-data
```

File field:

```text
cv
```

Response contains:

- CV analysis ID.
- User ID.
- Original filename.
- Saved file path/name.
- Raw extracted text.
- Extraction method.
- Candidate details.
- Skills.
- Experience years.
- Suggested job roles.
- Suggested role.
- Suggested level.
- Full parsed data.

#### Get Latest CV

```http
GET /api/cv/latest
```

Returns the latest `cv_analysis` record for the authenticated user.

#### Get CV By ID

```http
GET /api/cv/:id
```

Returns a single CV analysis record only if it belongs to the authenticated user.

#### Save Interview Context

```http
POST /api/cv/start-interview
```

Body with existing CV:

```json
{
  "cvId": 1,
  "company": "WSO2",
  "jobRole": "Software Engineer",
  "expertiseLevel": "Intermediate"
}
```

Body with fresh CV data:

```json
{
  "cvData": {
    "id": 1,
    "file_name": "cv.pdf",
    "file_path": "cv_1_123.pdf",
    "raw_text": "Extracted CV text",
    "parsed_data": {}
  },
  "company": "WSO2",
  "jobRole": "Software Engineer",
  "expertiseLevel": "Intermediate"
}
```

### Interview Routes

Base route:

```text
/api/interview
```

All interview routes require JWT authentication.

#### Start Interview Session

```http
POST /api/interview/start
```

Body:

```json
{
  "cvId": 1,
  "company": "WSO2",
  "jobRole": "Software Engineer",
  "expertiseLevel": "Intermediate"
}
```

Response:

```json
{
  "success": true,
  "message": "Interview session started successfully.",
  "sessionId": 1,
  "totalQuestions": 5,
  "currentQuestion": {
    "id": 1,
    "questionNumber": 1,
    "text": "Good morning John Doe, welcome! Could you please introduce yourself..."
  }
}
```

#### Get Session

```http
GET /api/interview/session/:id
```

Returns:

- Session data.
- Q&A logs.
- Current/latest question.

Special behavior:

- If the session is `in_progress` but no questions exist, the backend generates and logs question 1.

#### Submit Answer

```http
POST /api/interview/submit-answer
```

Body:

```json
{
  "sessionId": 1,
  "qaId": 1,
  "userAnswerText": "I am a full stack developer..."
}
```

Response when more questions remain:

```json
{
  "success": true,
  "isCompleted": false,
  "currentQuestion": {
    "id": 2,
    "questionNumber": 2,
    "text": "Can you describe one project from your CV..."
  }
}
```

Response when interview is complete:

```json
{
  "success": true,
  "isCompleted": true,
  "message": "Interview finished successfully."
}
```

#### Complete Session

```http
POST /api/interview/complete
```

Body:

```json
{
  "sessionId": 1
}
```

## Layer Dependencies

High-level dependency flow:

```text
index.js
  -> routes
    -> controllers
      -> middleware
      -> models
      -> services
        -> AIProvider
        -> external AI APIs
        -> document parsers
        -> OCR
      -> MySQL
```

Detailed examples:

```text
POST /api/register
  authRoutes
    -> authController.register
      -> User.findByEmail/findByMobile/findByNic
      -> bcrypt.hash
      -> User.createUser
      -> users table
```

```text
POST /api/cv/upload
  cvRoutes
    -> verifyToken
    -> cvUploadMiddleware
    -> cvController.uploadAndAnalyzeCV
      -> extractTextFromDocument
        -> pdf-parse/pdfjs-dist/tesseract.js OR mammoth
      -> parseResume
        -> AIProvider.generateJSON
        -> normalizeParsedData
        -> heuristicFallbackParse if needed
      -> CVModel.saveCVAnalysis
      -> cv_analysis table
```

```text
POST /api/interview/start
  interviewRoutes
    -> verifyToken
    -> interviewController.startSession
      -> CVModel.getCVAnalysisById/updateInterviewContext/saveCVAnalysis/getLatestCVByUserId
      -> InterviewModel.createSession
      -> HRAiAgentService.generateNextQuestion
        -> AIProvider.generateJSON
      -> InterviewModel.logQuestion
      -> interview_sessions table
      -> interview_qa_logs table
```

```text
POST /api/interview/submit-answer
  interviewRoutes
    -> verifyToken
    -> interviewController.submitAnswer
      -> InterviewModel.getSessionById
      -> InterviewModel.saveAnswer
      -> InterviewModel.completeSession OR updateQuestionIndex
      -> InterviewModel.getQALogs
      -> HRAiAgentService.generateNextQuestion
      -> InterviewModel.logQuestion
```

## Why The System Is Designed This Way

The backend separates responsibilities into clear layers:

- Routes define API paths.
- Middleware handles authentication and file upload validation.
- Controllers handle request/response flow and business decisions.
- Models isolate SQL operations.
- Services handle specialized logic like document extraction, OCR, AI parsing, and question generation.
- `AIProvider` isolates external AI-provider differences from the rest of the app.

This design makes the project easier to extend. For example:

- A new AI provider can be added inside `AIProvider` without changing controllers.
- A new file parser can be added inside `documentTextExtractor`.
- Interview scoring can be added as a new service without changing upload logic.
- More session types can be added by extending `interview_sessions` and `interviewController`.

## Important Business Rules Implemented

- Only authenticated users can upload CVs or start interviews.
- A user can only fetch CV records that belong to their own `user_id`.
- A user can only fetch interview sessions that belong to their own `user_id`.
- Registration requires unique email, mobile number, and NIC/passport.
- Passwords are never stored in plain text.
- CV upload accepts only PDF, DOC, and DOCX documents.
- CV upload size is limited to 10 MB.
- CV text must be extractable; empty/corrupted documents are rejected.
- Resume parsing must produce a normalized structure.
- Interview context requires a job role and expertise level.
- An interview session contains 5 questions.
- Question 1 is always introductory.
- Later questions are intended to be deeper and CV-specific.
- Each answer is saved before generating the next question.
- The interview is marked completed after the final question.

## AI Provider Behavior

The AI provider chooses a backend based on available API keys.

Provider selection:

```text
If key starts with "xai-"  -> xAI
If key starts with "gsk_"  -> Groq
If key starts with "AIza"  -> Gemini
Otherwise                 -> Try Groq, then xAI
If all fail/no key         -> Pollinations fallback
```

Groq model fallback order:

```text
llama-3.3-70b-versatile
llama-3.1-8b-instant
llama3-8b-8192
mixtral-8x7b-32768
```

xAI model fallback order:

```text
grok-beta
grok-2-latest
grok-2-1212
```

Gemini model:

```text
gemini-1.5-flash
```

The resume parser expects strict JSON. The HR question generator also asks for JSON:

```json
{
  "question": "Question text here"
}
```

If the AI returns Markdown code fences, the services strip them before parsing.

## Local Files And Upload Storage

Uploaded CV files are saved here:

```text
uploads/cvs
```

The database stores:

- original filename in `file_name`
- saved local filename in `file_path`

The backend does not currently expose uploaded files through a public static route.

## Error Handling

The API generally returns:

- `400` for bad input or upload errors.
- `401` for missing/invalid tokens.
- `404` for missing records or access-denied lookups.
- `422` for validation failures and unreadable CV text.
- `500` for internal server errors.

Most controller errors are logged to the server console and returned as general messages to the client.

## Known Technical Gaps And Recommended Improvements

Recommended next backend improvements:

- Add `.env.example` because `.env` is ignored by Git.
- Replace `default_secret_key` fallback with a startup error in production.
- Include `first_name` and `last_name` in JWT or load user profile in interview controllers before generating question 1.
- Update `gender` in `updateProfile`, since the controller currently receives it but SQL does not save it.
- Validate that `qaId` belongs to `sessionId` before saving an answer.
- Add password strength validation for password reset.
- Add a route for listing all CV analyses if needed by the frontend.
- Add interview evaluation/scoring after completion.
- Add transaction handling around session creation and first-question logging.
- Add cleanup for failed CV uploads when text extraction or AI parsing fails.
- Add rate limiting for auth and AI-heavy endpoints.
- Add centralized error handling middleware.
- Add automated tests for auth, CV upload, parser fallback, session flow, and access control.
- Move uploaded files to cloud storage for production.
- Add structured logging instead of plain `console.log`.

## Testing Status

Current package script:

```json
{
  "test": "echo \"Error: no test specified\" && exit 1"
}
```

There is no automated test suite yet.

There is a manual scratch file:

```text
scratch_test.js
```

It calls `HRAiAgentService.generateNextQuestion` with mock CV data and prints the first generated question. This is useful for quick local checking of the AI interview question flow, but it is not a formal test.

Run it manually with:

```bash
node scratch_test.js
```

## Suggested Development Workflow

1. Start MySQL locally.
2. Create `.env` with database and JWT settings.
3. Install dependencies with `npm install`.
4. Start the backend with `npm run dev`.
5. Confirm health check at `GET /`.
6. Register a user.
7. Login and copy the returned token.
8. Upload a CV with `Authorization: Bearer <token>`.
9. Save or choose interview context.
10. Start an interview session.
11. Submit answers until the session completes.

## Summary

This backend already contains the core foundation for an AI interview training product:

- candidate account system
- secure login
- CV ingestion
- document text extraction
- AI resume understanding
- interview context selection
- personalized HR question generation
- persistent interview session tracking

The most important missing product layer is post-interview evaluation: scoring answers, identifying strengths/weaknesses, and generating improvement feedback. Once that is added, the system will move from interview practice into full interview coaching.

## C3 Coaching Dashboard And Longitudinal Progress Tracking

C3 adds baseline-relative coaching analytics without changing existing auth, CV, or interview endpoints.

### New Database Additions

New `interview_sessions` columns:

- `session_type`: `warmup` or `interview`, default `interview`.
- `session_number`: per-user interview sequence number.

New `interview_qa_logs` columns:

- `question_type`: `hr`, `technical`, `behavioural`, or `english`, default `hr`.
- `answered_at`
- `answer_word_count`
- `answer_score`
- `response_latency_sec`

New tables:

- `session_signals`: stores expression indicators from face, voice, or text sources.
- `user_baselines`: stores versioned personal baselines.
- `coaching_tips`: stores explainable tips, evidence, follow status, and outcomes.
- `self_ratings`: stores post-session self-rated improvement and tip feedback.
- `drift_events`: stores detected delivery drift events.

### C3 Endpoints

All C3 endpoints require:

```http
Authorization: Bearer <token>
```

Signal ingestion:

```http
POST /api/c3/signals
```

Body:

```json
{
  "sessionId": 1,
  "qaId": 10,
  "readings": [
    {
      "t_sec": 2,
      "source": "face",
      "metrics": {
        "tension": 0.43,
        "gaze_off": 0.21
      }
    }
  ]
}
```

Warm-up session:

```http
POST /api/c3/warmup
```

Body to create:

```json
{
  "jobRole": "Warm-up Baseline"
}
```

Body to mark existing session:

```json
{
  "sessionId": 1
}
```

Build baseline:

```http
POST /api/c3/baseline/build
POST /api/c3/baseline/refresh
```

Body:

```json
{
  "sessionId": 1
}
```

Progress:

```http
GET /api/c3/progress/overview
GET /api/c3/progress/per-type
GET /api/c3/progress/comparison
GET /api/c3/session/:sessionId
```

Drift:

```http
GET /api/c3/drift
```

Coaching:

```http
POST /api/c3/coaching/:sessionId/generate
GET /api/c3/tips
GET /api/c3/tips?sessionId=1
PATCH /api/c3/tips/:tipId/followed
POST /api/c3/tips/evaluate
GET /api/c3/tips/outcomes
```

Followed body:

```json
{
  "followed": "yes"
}
```

Self-rating:

```http
POST /api/c3/self-rating
```

Body:

```json
{
  "sessionId": 1,
  "improvementRating": 4,
  "tipClarityRating": 5,
  "tipUsefulnessRating": 4,
  "comment": "The practice tip was clear."
}
```

Admin/research export:

```http
GET /api/c3/evaluation/dataset
GET /api/c3/evaluation/csv
GET /api/c3/evaluation/correlation
```

Use `?includeDemo=true` to include seeded `@demo.local` users.

### C3 Formulas

Baseline per metric:

```text
mean = sum(values) / n
std = max(population_standard_deviation(values), BASELINE_STD_FLOOR)
confidence = min(1, average_metric_readings / BASELINE_CONFIDENCE_TARGET_READINGS)
```

Per-question deviation:

```text
metric_deviation = (question_metric_mean - baseline_metric_mean) / baseline_metric_std
```

Delivery deviation:

```text
delivery_deviation = average(abs(metric_deviation)) across metrics with enough readings
```

Progress comparison:

```text
fixed_threshold_progress = latest raw average answer_score - early raw average answer_score
baseline_relative_progress = early delivery_deviation - latest delivery_deviation
```

Drift z-score:

```text
z_score = (recent_metric_mean - reference_metric_mean) / reference_metric_std
```

Spearman correlation:

```text
Pearson correlation over ranked progress values and ranked self-rated improvement values
```

### C3 Thresholds

Configured in:

```text
src/config/c3Config.js
```

Current values:

- `DRIFT_Z_THRESHOLD`: `1.5`
- `MIN_DRIFT_SESSIONS`: `4`
- `MIN_SIGNAL_READINGS_PER_METRIC`: `3`
- `BASELINE_STD_FLOOR`: `0.05`
- `OUTCOME_MARGIN`: `0.05`
- `BASELINE_CONFIDENCE_TARGET_READINGS`: `10`
- `MAX_SIGNAL_BATCH_SIZE`: `500`
- `RECENT_DRIFT_SESSION_COUNT`: `2`
- `REFERENCE_DRIFT_SESSION_COUNT`: `3`

### C3 Seed Data

Create four demo users, each with one warm-up and six interview sessions:

```bash
npm run seed:c3
```

Delete demo users and cascaded demo data:

```bash
npm run seed:c3:delete
```

Demo user emails use:

```text
@demo.local
```

Demo password:

```text
demo12345
```

### C3 Tests

Run pure-function tests:

```bash
npm test
```

The tests cover baseline computation, per-question deviation, drift classification, findings rules, outcome evaluation, and Spearman correlation.

### C3 Known Limits

- C3 does not infer true emotions or diagnose stress. It reports delivery deviation and expression indicators only.
- If there is too little signal data, C3 returns an insufficient-data status instead of invented scores.
- `answer_score` is optional and can be filled later by another scoring component.
- Coaching text uses the existing `AIProvider`; if the LLM fails, deterministic fallback tips are used.
- Baselines are versioned and are not silently modified by drift detection.
