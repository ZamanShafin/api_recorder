# AetherFlow API Engine & Marketplace

A prototype browser recorder to LLM-generated API engine. Record dynamic browser flows via the Chrome extension, parameterize inputs using Gemini, and deploy scalable API endpoints in seconds.

## Features
* **Chrome Extension Recorder**: Capture clicks, form fills, and target data selectors.
* **LLM-Powered Data Extraction**: Define natural language prompts to scrape repeating lists into structured JSON.
* **Playwright Stealth**: Running engine with anti-bot evasion configs (User-Agents, webdriver bypass).
* **Community Marketplace**: Share APIs, subscribe to public endpoints, and manage creator billing.

## Setup Instructions

1. **Install Dependencies**:
   ```bash
   npm install
   npx playwright install
   ```
2. **Configure Environment**:
   Create a `.env` file in the root directory:
   ```env
   GEMINI_API_KEY=YOUR_GEMINI_API_KEY
   PORT=3000
   ```
3. **Run the Server**:
   ```bash
   npm run dev
   ```
4. **Load Browser Extension**:
   * Open Chrome/Edge and go to extensions.
   * Enable Developer Mode.
   * Click **Load unpacked** and select the `/recorder` folder.
