import fs from 'fs';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import path from 'path';

export async function convertAudioToMp3(inputFilePath: string, outputFilePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error('ffmpegPath is null or undefined.'));
    }

    execFile(ffmpegPath, ['-i', inputFilePath, outputFilePath], (error: Error | null, stdout, stderr) => {
      if (error) {
        console.error('FFmpeg error:', error);
        console.error('FFmpeg stderr:', stderr);
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

export async function resizeImageFile(inputPath: string, outputPath: string, maxWidth: number, maxHeight: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error('ffmpegPath is null or undefined.'));
    }

    const ffmpegArgs = [
      '-i', inputPath,
      '-vf', `scale=w=min(${maxWidth}\\,iw):h=min(${maxHeight}\\,ih):force_original_aspect_ratio=decrease`,
      '-c:v', 'mjpeg',
      '-q:v', '2',
      outputPath
    ];

    execFile(ffmpegPath, ffmpegArgs, (error: Error | null, stdout, stderr) => {
      if (error) {
        console.error('FFmpeg error:', error);
        console.error('FFmpeg stderr:', stderr);
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
