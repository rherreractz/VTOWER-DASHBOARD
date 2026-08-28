export default function PrivacidadPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-zinc-100">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Política de Privacidad</h1>
      <p className="mb-8 text-sm text-zinc-500">Live Desarrollos — Última actualización: {new Date().toLocaleDateString('es-MX')}</p>

      <div className="flex flex-col gap-6 text-sm leading-relaxed text-zinc-300">
        <section>
          <h2 className="mb-2 text-base font-semibold text-zinc-100">1. Información que recopilamos</h2>
          <p>
            Cuando interactúas con nuestros anuncios o formularios (incluyendo Instant Forms de Meta), podemos recopilar tu
            nombre, correo electrónico, número de teléfono, y datos relacionados con tu interés en nuestros desarrollos
            inmobiliarios.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-zinc-100">2. Uso de la información</h2>
          <p>
            Usamos tus datos para contactarte respecto a tu interés en nuestras propiedades, dar seguimiento a tu solicitud,
            y mejorar nuestras campañas publicitarias. No vendemos tu información a terceros.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-zinc-100">3. Compartir información</h2>
          <p>
            Podemos compartir tu información con proveedores de servicios que nos ayudan a operar nuestro negocio (como
            plataformas de CRM), siempre bajo acuerdos de confidencialidad.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-zinc-100">4. Tus derechos</h2>
          <p>
            Puedes solicitar acceso, corrección, o eliminación de tus datos personales en cualquier momento, escribiéndonos a
            través de nuestros canales de contacto oficiales.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-zinc-100">5. Contacto</h2>
          <p>Para preguntas sobre esta política, contáctanos a través de nuestros canales oficiales de Live Desarrollos.</p>
        </section>
      </div>
    </div>
  );
}