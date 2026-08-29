import nextConfig from 'eslint-config-next';

/**
 * Configuración plana de ESLint (formato obligatorio desde ESLint v9).
 * `eslint-config-next` ya exporta un array de configuración plana con las
 * reglas de Next.js + React + TypeScript + accesibilidad, así que solo lo
 * re-exportamos. Agrega objetos extra a este array si necesitas reglas
 * propias del proyecto.
 */
const config = [...nextConfig];

export default config;
