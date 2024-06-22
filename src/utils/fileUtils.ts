import fs from 'fs';
import sharp from 'sharp';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

export async function convertAudioToMp3(inputFilePath: string, outputFilePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error('ffmpegPath is null or undefined.'));
    }

    execFile(ffmpegPath, ['-i', inputFilePath, outputFilePath], (error: Error | null) => {
      if (error) {
        reject(error);
      } else {
        resolve(outputFilePath);
      }
    });
  });
}

export async function convertImageToBase64(filePath: string): Promise<string> {
  const fileBuffer = await fs.promises.readFile(filePath);
  return fileBuffer.toString('base64');
}

export async function resizeImage(inputPath: string, outputPath: string, maxWidth: number, maxHeight: number): Promise<sharp.OutputInfo> {
  return sharp(inputPath)
    .resize(maxWidth, maxHeight, {
      fit: sharp.fit.inside,
      withoutEnlargement: true
    })
    .toFile(outputPath);
}
