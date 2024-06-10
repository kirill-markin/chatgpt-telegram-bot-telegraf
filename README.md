# Telegram bot for chatGPT with voice recognition

## Deploy

1. Copy `.env.example` to `.env` and fill in the values
2. Play with `settings/private_en.yaml` file
3. Run `docker-compose up -d`

## Run in Docker

Run Docker.

```bash
docker build -t my-test . && docker run --rm -it my-test && docker image rm my-test
```

## Run locally npm

1. Copy `.env.example` to `.env` and fill in the values
2. Play with `settings/private_en.yaml` file
3. Run `npm install`
4. Run `npm start`

## Run tests

```bash
npm test
```
