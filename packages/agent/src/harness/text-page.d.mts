export function utf8Prefix(bytes: Buffer, limit: number): string;
export function textPage(
  value: string,
  offset: number,
  limit: number,
): {
  offset: number;
  nextOffset: number | null;
  totalBytes: number;
  encoding: "utf8";
  text: string;
};
