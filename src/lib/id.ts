import { customAlphabet } from "nanoid";

const ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

type GenerateIdOptions = {
  length?: number;
};

export function generateId({ length = 12 }: GenerateIdOptions = {}): string {
  return customAlphabet(ID_ALPHABET, length)();
}
