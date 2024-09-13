const dotenv = require("dotenv");
const fs = require("fs");
const axios = require("axios");
const path = require("path");

// Force rewrite all env variables from .env file
if (fs.existsSync(".env")) {
  const envConfig = dotenv.parse(fs.readFileSync(".env"));
  for (const k in envConfig) {
    process.env[k] = envConfig[k];
  }
}

const configPath = process.env.SETTINGS_PATH || './settings/private_en.yaml';

console.log(`Config path: ${configPath}`);
console.log(`process.env.SETTINGS_PATH: ${process.env.SETTINGS_PATH}`);

// Function to check if the file exists locally
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

// Function to download the file from a remote URL
async function downloadFile(url, localPath) {
  const writer = fs.createWriteStream(localPath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// Function to copy a local file to the temporary directory
function copyLocalFile(srcPath, destPath) {
  return new Promise((resolve, reject) => {
    fs.copyFile(srcPath, destPath, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// Function to check and create the 'temp' directory
function ensureTempDirExists(tempDirPath) {
  return new Promise((resolve, reject) => {
    fs.mkdir(tempDirPath, { recursive: true }, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// Main function to check and fetch the config file
async function fetchConfig() {
  const tempDirPath = path.join(__dirname, '..', 'temp');
  const localConfigPath = path.join(tempDirPath, '__temp_config.yaml');

  try {
    // Ensure the 'temp' directory exists
    await ensureTempDirExists(tempDirPath);
    console.log(`Directory ensured: ${tempDirPath}`);

    console.log(`Config path: ${configPath}`);

    if (!configPath.startsWith('http://') && !configPath.startsWith('https://')) {
      if (fileExists(configPath)) {
        console.log(`Using local config file: ${configPath}`);
        try {
          await copyLocalFile(configPath, localConfigPath);
          console.log(`Config file copied to: ${localConfigPath}`);
          process.env.SETTINGS_PATH = localConfigPath; // Update the environment variable
        } catch (error) {
          console.error('Failed to copy the local config file:', error);
          process.exit(1);
        }
      } else {
        console.error(`Local config file not found: ${configPath}`);
        process.exit(1);
      }
      return;
    }

    try {
      await downloadFile(configPath, localConfigPath);
      console.log(`Config file downloaded to: ${localConfigPath}`);
      process.env.SETTINGS_PATH = localConfigPath; // Update the environment variable
    } catch (error) {
      console.error('Failed to download the config file:', error);
      process.exit(1);
    }
  } catch (error) {
    console.error('Failed to ensure temp directory exists:', error);
    process.exit(1);
  }
}

fetchConfig();