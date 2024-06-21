import fs from 'fs';
import sharp from 'sharp';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

export async function convertToMp3(inputFilePath: string, outputFilePath: string) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, ['-i', inputFilePath, outputFilePath], (error) => {
      if (error) {
        reject(error);
      } else {
        resolve(outputFilePath);
      }
    });
  });
}

export async function encodeImageToBase64(filePath: string): Promise<string> {
  const fileBuffer = await fs.promises.readFile(filePath);
  return fileBuffer.toString('base64');
}

export async function resizeImage(inputPath: string, outputPath: string, maxWidth: number, maxHeight: number) {
  return sharp(inputPath)
    .resize(maxWidth, maxHeight, {
      fit: sharp.fit.inside,
      withoutEnlargement: true
    })
    .toFile(outputPath);
}
