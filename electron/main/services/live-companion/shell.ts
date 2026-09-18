import { execFile } from 'node:child_process'

export function execFileText(file: string, args: string[], timeout = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr.trim() || stdout.trim() || error.message
        reject(new Error(detail))
        return
      }
      resolve(stdout.trim())
    })
  })
}
