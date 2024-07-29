export interface ISDPParser {
    parse(sdp: string): any;
    stringify(sdp: any): string;
}