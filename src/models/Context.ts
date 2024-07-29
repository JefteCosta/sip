export interface Context {
    user?: string;
    realm?: string;
    password?: string;
    userhash?: string;
    nonce?: string;
    cnonce?: string;
    algorithm?: string;
    qop?: string;
    method?: string;
    uri?: string;
    entity?: string;
    nc?: number;
    ha1?: string;
    proxy?: boolean;
    opaque?: string;
    cancelled?: boolean;
    cancellers?: { [key: string]: () => void };
    domain?: string;
}
