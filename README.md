<!-- ---
title: Node HTTP Module
description: A HTTP module server
tags:
  - http
  - nodejs
  - javascript
--- -->

# Telegram bot for chatGPT with voice recognition

## Deploy

1. Copy `.env.example` to `.env` and fill in the values
2. Copy `settings.yml.example` to `settings.yml` and fill in the values
3. Run `docker-compose up -d`

<!-- 
This example starts an [HTTP Module](https://nodejs.org/api/http.html) server.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template/ZweBXA)

## 💁‍♀️ How to use

- Install dependencies `yarn`
- Connect to your Railway project `railway link`
- Start the development server `railway run yarn start`

## 📝 Notes

The server started simply returns a `Hello World` payload. The server code is located in `server.mjs`. -->

## Run locally

```bash
docker build -t my-test . && docker run --rm -it my-test
```
