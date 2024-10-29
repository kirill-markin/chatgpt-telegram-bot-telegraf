# Open source ChatGPT Telegram Bot via Telegraf

Open source ChatGPT Telegram Bot via Telegraf is an advanced Telegram bot designed to provide seamless text, voice, and photo interactions using OpenAI's ChatGPT. Built with the Telegraf framework, this bot allows users to ask ChatGPT questions via text messages, voice messages, and even photos, receiving text responses. Ideal for enhancing user engagement, customer support, and more, this bot leverages PostgreSQL for data storage and can integrate with Pinecone vector database to improve the quality of answers by utilizing long-term memory.

## Demo ChatGPT Telegram Bot

Telegram Bot from this repository is available at:  
<https://t.me/chat_gpt_ai_open_source_bot>

Feel free to interact with the bot and test its capabilities!

## Cloud Deployment with One-Click Buttons

| [![Deploy to Heroku](https://www.herokucdn.com/deploy/button.svg)](https://dashboard.heroku.com/new?template=https%3A%2F%2Fgithub.com%2Fkirill-markin%2Fchatgpt-telegram-bot-telegraf) | [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy) | [![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/6T8UU3?referralCode=ln-goT) |
|---|---|---|

## Features

- **Text Message Processing**: Handles text messages, converting them to responses.
- **Voice Message Processing**: Handles voice messages, converting them to text for processing.
- **Photo Message Processing**: Handles photo messages, converting them to text for processing.
- **OpenAI's ChatGPT Integration**: Utilizes the powerful ChatGPT model to generate responses.
- **Perplexity AI Integration**: Enhanced search capabilities for more accurate responses.
- **PostgreSQL Database**: Stores user data and interactions in a PostgreSQL database.
- **Docker and Docker Compose Support**: Easily deploy the bot using Docker and Docker Compose.
- **Pinecone Integration**: Optional long-term memory support using Pinecone.

## Configuration

1. Clone the repository:

    ```bash
    git clone https://github.com/kirill-markin/chatgpt-telegram-bot-telegraf.git
    cd chatgpt-telegram-bot-telegraf
    ```

2. Copy the `.env.example` file to `.env` and fill in the required values:

    ```bash
    cp .env.example .env
    ```

3. Open the `.env` file and configure the following variables:

    ```env
    TELEGRAM_BOT_TOKEN=replace_with_your_telegram_bot_token
    OPENAI_API_KEY=replace_with_your_openai_api_key
    DATABASE_URL=replace_with_your_database_url

    # You can change the settings path if needed
    # Path can be URL to static file or local file
    SETTINGS_PATH=./settings/private_en.yaml

    # Optional: Perplexity API key for enhanced search capabilities
    PERPLEXITY_API_KEY=replace_with_your_perplexity_api_key

    # Optional: Set the maximum tokens for trial users, default is 0 (no trial)
    MAX_TRIAL_TOKENS=100000

    # Optional: Only if you want to use Pinecone for Long-Term Memory
    PINECONE_API_KEY=replace_with_your_pinecone_api_key
    PINECONE_INDEX_NAME=replace_with_your_pinecone_index_name
    ```

4. If you use remote settings, you can set the URL in the `.env` file in `SETTINGS_PATH`. The URL should point to a YAML file with the the same structure as the `settings/private_en.yaml` file. For example:

    ```env
    SETTINGS_PATH=https://kirill-markin.com/data/chatgpt-telegram-bot-telegraf_settings.yaml
    ```

## Deploy with Docker Compose

1. Make sure you have the latest version of Docker.
2. Start the services:

    ```bash
    docker compose up -d
    ```

3. To stop the services, run:

    ```bash
    docker compose down
    ```

## Running with Docker

1. Build and run the Docker container:

    ```bash
    docker build -t chatgpt-telegram-bot-telegraf .
    docker run --rm -it chatgpt-telegram-bot-telegraf
    ```

## Installing and Running Locally

### Requisites

Ensure you have met the following requirements:

- Node.js and npm installed, long-term support (lts) version recomended to avoid warnings
- PostgreSQL database
- OpenAI API key
- Perplexity API key (optional, for enhanced search capabilities)
- Docker and Docker Compose (optional)
- Pinecone API key (optional)

### Steps

1. Clone the repository:

    ```bash
    git clone https://github.com/kirill-markin/chatgpt-telegram-bot-telegraf.git
    cd chatgpt-telegram-bot-telegraf
    ```

2. Copy the `.env.example` file to `.env` and fill in the required values:

    ```bash
    cp .env.example .env
    ```

3. Open the `.env` file and configure the following variables

4. Install the dependencies:

    ```bash
    npm install
    ```

5. Run prestart script to fetch the config file:

    ```bash
    npm run prestart
    ```

6. Start the bot:

    ```bash
    npm start
    ```

## Running Tests

1. To run the tests, use the following command:

    ```bash
    npm test
    ```

## User Management

Ensure all dependencies are installed:

```sh
npm install
```

### Displaying Help Information

To display help information about available commands, use the following command:

```sh
npm run help
```

### Listing All PREMIUM Users

To print list of all PREMIUM users, use the following command:

```sh
npm run list-premium
```

The output will include the user ID, username, and the creation date formatted as `Created at: YYYY-MM-DD HH:MM:SS UTC`, sorted by the most recent creation date first.

### Setting a User as PREMIUM

You can set a user as PREMIUM via the command line.

Use the following command to set a user as PREMIUM:

```sh
npm run set-premium <userId>
```

Replace `<userId>` with the ID of the user you want to set as PREMIUM.

Example:

```sh
npm run set-premium 123456789
```

Please google how to get the user ID in Telegram, as it is not the same as the username.

### Removing PREMIUM Status from a User

To remove the PREMIUM status from a user, use the following command:

```sh
npm run remove-premium <userId>
```

Example:

```sh
npm run remove-premium 123456789
```

## Table Entities Description

- The `users` table stores information about the bot users.
- The `messages` table stores the messages exchanged between users and the bot.
- The `events` table logs various events related to user interactions and bot operations.

## Contributing

Contributions are welcome! Please fork the repository and create a pull request with your changes.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
