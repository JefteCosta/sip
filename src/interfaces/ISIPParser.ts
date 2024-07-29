export interface ISIPParser {
    parse(data: string): any;
    stringify(msg: any): string;
    parseUri(uri: string): any;
    stringifyUri(uri: any): string;
}