// Paleta sobria en modo oscuro + un único acento corporativo.
// Colores explícitos (no variables de tema) para que el dashboard se vea
// igual sin importar la configuración de dark/light mode del resto del proyecto.
export const ACCENT = '#EFF767'; // acento corporativo personalizado

export const GRAYS = {
  950: '#09090B', // fondo de página
  900: '#18181B', // fondo de tarjetas
  800: '#27272A', // bordes / divisores
  700: '#3F3F46', // superficies secundarias
  600: '#52525B', // categoría "Otro" en gráficas
  500: '#71717A', // texto muted
  400: '#A1A1AA', // texto secundario sobre fondo oscuro
  200: '#D4D4D8',
  100: '#F4F4F5', // texto principal sobre fondo oscuro
} as const;