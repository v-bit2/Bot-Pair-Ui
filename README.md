# VOLTRA MINI — WhatsApp Bot Creator

VOLTRA MINI is a fast, modern React web application for creating and managing WhatsApp bots with instant pairing code and QR linking.

---

## 🚀 How to Deploy on Render

This application is built with React, Vite, and TypeScript. The recommended and most cost-effective way to deploy it on Render is as a **Static Site**.

---

### Option 1: Manual Setup via Render Dashboard (Recommended)

1. **Push code to GitHub or GitLab**
   Ensure your latest code (including `package.json` and `vite.config.ts`) is pushed to your git repository.

2. **Create a new Static Site on Render**
   - Log in to your [Render Dashboard](https://dashboard.render.com).
   - Click **New +** and select **Static Site**.
   - Connect your Git repository.

3. **Configure Build Settings**
   - **Name**: `voltra-mini` (or your preferred name)
   - **Branch**: `main` (or your active branch)
   - **Root Directory**: `.` (leave default)
   - **Build Command**: `npm run build`
   - **Publish Directory**: `dist`

4. **Set Up Redirects and Rewrites (Important!)**
   In your Static Site settings on Render, navigate to **Redirects / Rewrites** and add the following two rules:

   | Source | Destination | Action | Reason |
   | :--- | :--- | :--- | :--- |
   | `/api/*` | `https://pro-bot-aykk.onrender.com/api/*` | **Rewrite** | Proxies API calls to the Voltra backend without CORS issues |
   | `/*` | `/index.html` | **Rewrite** | Enables single-page application (SPA) client-side routing |

5. **Deploy**
   Click **Create Static Site**. Render will install dependencies, execute `npm run build`, and deploy your frontend instantly.

---

### Option 2: 1-Click Deployment via Render Blueprint (`render.yaml`)

This repository includes a `render.yaml` file pre-configured for Render Blueprints.

1. Go to [Render Dashboard Blueprints](https://dashboard.render.com/blueprints).
2. Click **New Blueprint Instance**.
3. Connect your repository. Render will automatically detect `render.yaml` and configure:
   - Build command (`npm run build`)
   - Output directory (`dist`)
   - SPA client routing fallback (`/*` → `/index.html`)
   - Backend API proxy rewrite (`/api/*` → `https://pro-bot-aykk.onrender.com/api/*`)
4. Click **Apply**.

---

## 🛠️ Local Development

To run this project locally on your machine:

```bash
# 1. Install dependencies
npm install

# 2. Start local development server with HMR and API proxy
npm run dev

# 3. Build for production
npm run build
```

---

## ⚙️ Environment Variables (Optional)

| Variable | Description | Default |
| :--- | :--- | :--- |
| `VITE_API_BASE_URL` | Override the default API base URL (Leave empty when using Render rewrite rules or Vite dev proxy). | `""` (relative) |
