
import { IError } from "#interfaces/Utils";

export type StringBase64 = Buffer;
export type Debug = (e: IError) => void;
export type ToBase64 = (s: StringBase64) => string;