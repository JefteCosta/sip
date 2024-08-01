import * as util from 'util';

export interface IError extends Error {
    stack?: string;
}
interface Lengthwise {
  length: number;
}
interface ToolsFn<Type extends Lengthwise> {
    (arg: Type): Type;
  }

export type StringBase64 = Buffer;
export type Debug = (e: IError) => void;
export type ToBase64 = (s: StringBase64) => string;

export const debug: Debug = (e: IError) => {
    if (e.stack) {
        util.debug(e + '\n' + e.stack);
    } else {
        util.debug(util.inspect(e));
    }
};
export const toBase64: ToolsFn<string> = (s: string):string => { 
    switch(s.length % 3) {
    case 1:
      s += '  ';
      break;
    case 2:
      s += ' ';
      break;
    default:
    }
  
    return Buffer.from(s).toString('base64').replace(/\//g, '_').replace(/\+/g, '-');
  }

 