import fs from 'fs';

export const deleteSQLiteDatabaseFiles = (fileName: string): void => {
  for (const file of [fileName, `${fileName}-shm`, `${fileName}-wal`]) {
    if (!fs.existsSync(file)) continue;

    try {
      fs.unlinkSync(file);
    } catch (error) {
      console.log(error);
    }
  }
};
