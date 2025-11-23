declare module "ssh2-sftp-client" {
  interface FileInfo {
    type: string;
    name: string;
    size: number;
    modifyTime: number;
    accessTime: number;
    rights: {
      user: string;
      group: string;
      other: string;
    };
    owner: number;
    group: number;
  }

  interface ConnectOptions {
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
    readyTimeout?: number;
  }

  class SftpClient {
    connect(options: ConnectOptions): Promise<void>;
    mkdir(path: string, recursive?: boolean): Promise<void>;
    put(localPath: string, remotePath: string): Promise<void>;
    stat(path: string): Promise<{ size: number }>;
    list(path: string): Promise<FileInfo[]>;
    delete(path: string): Promise<void>;
    end(): Promise<void>;
  }

  export default SftpClient;
}

