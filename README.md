# ChatGPT Telegram Bot via Telegraf

ChatGPT Telegram Bot via Telegraf is an advanced Telegram bot designed to provide seamless text and voice interactions using OpenAI's ChatGPT. Built with the Telegraf framework, this bot allows users to ask ChatGPT questions via voice messages and receive text responses. Ideal for enhancing user engagement, customer support, and more, this bot leverages PostgreSQL for data storage and can integrate with Pinecone vector database to improve the quality of answers by utilizing long-term memory.

## Demo ChatGPT Telegram Bot

Telegram Bot from this repository is available at:  
<https://t.me/chat_gpt_ai_open_source_bot>

Feel free to interact with the bot and test its capabilities!

## Cloud Deployment

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/6T8UU3?referralCode=ln-goT)

## Features

- **Text and Voice Message Processing**: Handles both text and voice messages, converting voice to text for processing.
- **OpenAI's ChatGPT Integration**: Utilizes the powerful ChatGPT model to generate responses.
- **Docker Support**: Easily deployable using Docker.
- **PostgreSQL Database**: Stores user data and interactions in a PostgreSQL database.
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
    SETTINGS_PATH=./settings/private_en.yaml

    # Only if you want to use Pinecone for Long-Term Memory
    PINECONE_API_KEY=replace_with_your_pinecone_api_key
    PINECONE_INDEX_NAME=replace_with_your_pinecone_index_name
    ```

4. Adjust the settings in `settings/private_en.yaml` as needed.

## Deploy with Docker Compose

1. Ensure Docker Compose is installed on your machine.
2. Start the services:

    ```bash
    docker-compose up -d
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

- Node.js and npm installed
- PostgreSQL database
- OpenAI API key
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

5. Start the bot:

    ```bash
    npm start
    ```

## Running Tests

1. To run the tests, use the following command:

    ```bash
    npm test
    ```

## User Management

### Setting a User as PREMIUM

You can set a user as PREMIUM via the command line.

1. Ensure all dependencies are installed:

   ```sh
   npm install
   ```

2. Use the following command to set a user as PREMIUM:

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

### Listing All PREMIUM Users

To print list of all PREMIUM users, use the following command:

```sh
npm run list-premium
```

The output will include the user ID, username, and the creation date formatted as `Created at: YYYY-MM-DD HH:MM:SS UTC`, sorted by the most recent creation date first.

## Table Entities Description

- The `users` table stores information about the bot users.
- The `messages` table stores the messages exchanged between users and the bot.
- The `events` table logs various events related to user interactions and bot operations.

## Contributing

Contributions are welcome! Please fork the repository and create a pull request with your changes.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
