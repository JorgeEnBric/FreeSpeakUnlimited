let token: string | null = null;
let bloqueado = false;
let inicializado = false;

export function setToken(t: string | null) { token = t; }
export function getToken(): string | null { return token; }
export function estaBloqueado(): boolean { return bloqueado; }
export function bloquear(): void { bloqueado = true; token = null; }
export function desbloquear(): void { bloqueado = false; }
export function estaInicializado(): boolean { return inicializado; }
export function marcarInicializado(): void { inicializado = true; }
