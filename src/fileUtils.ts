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
