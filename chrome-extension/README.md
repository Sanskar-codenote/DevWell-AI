# DevWell Chrome Extension

This package contains the DevWell Chrome extension.

Canonical docs:
- Extension functionality and technical architecture: [../docs/EXTENSION.md](../docs/EXTENSION.md)
- Website/backend integration contract: [../docs/WEBSITE.md](../docs/WEBSITE.md)

## Local Setup

1. Start backend:
```bash
cd ../backend
npm install
npm start
```

2. Load extension:
- Open `chrome://extensions`
- Enable Developer mode
- Load unpacked `chrome-extension/`
- Pin extension
