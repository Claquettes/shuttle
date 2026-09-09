declare module "ssh2-sftp-client" {
  export interface FileInfo {
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
    privateKey?: string | Buffer;
    passphrase?: string;
    readyTimeout?: number;
    /** Vérification de la clé d'hôte : retourner false rejette la connexion */
    hostVerifier?: (key: Buffer) => boolean;
  }

  class SftpClient {
    connect(options: ConnectOptions): Promise<void>;
    mkdir(path: string, recursive?: boolean): Promise<void>;
    put(localPath: string, remotePath: string): Promise<void>;
    stat(path: string): Promise<{ size: number }>;
    list(path: string): Promise<FileInfo[]>;
    exists(path: string): Promise<false | "d" | "-" | "l">;
    rename(fromPath: string, toPath: string): Promise<void>;
    delete(path: string, noErrorOK?: boolean): Promise<void>;
    end(): Promise<void>;
  }

  export default SftpClient;
}
