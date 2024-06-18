import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

export async function convertOgaToMp3(fileId: string) {
  const inputFilePath = `./${fileId}.oga`;
  const outputFilePath = `./${fileId}.mp3`;

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
