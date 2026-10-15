import { crc32, deflateSync } from "node:zlib";

export function png(width: number, height: number) {
  const chunk = (name: string, content: Buffer) => {
    const data = Buffer.concat([Buffer.from(name), content]);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(content.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(data));
    return Buffer.concat([size, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((width * 3 + 1) * height))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
