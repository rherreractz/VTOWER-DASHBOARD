export interface RawLead {
  Fecha: string;
  Campana: string;
  Nombre: string;
  Correo: string;
  Telefono: string;
  Presupuesto: string;
  Motivo: string;
  TiempoParaInvertir: string;
  Equipo: string;
  Fuente: string;
  Proveedor: string;
  Formulario: string;
  Etapa: string;
  Comentarios: string;
}

export type LeadStatus = 'Válido' | 'Duplicado';
export type MotivoCategoria = 'Vivir' | 'Invertir' | 'Otro';

export interface ProcessedLead extends RawLead {
  /** id estable para usar como `key` en React */
  id: string;
  status: LeadStatus;
  /** Fecha parseada a objeto Date (o null si no se pudo interpretar) */
  parsedDate: Date | null;
  /** Presupuesto limpio, ej. "$2 a 3 MDP" */
  presupuestoClean: string;
  /** Motivo limpio para mostrar en tabla, ej. "Vivir en Olivia" */
  motivoClean: string;
  /** TiempoParaInvertir limpio, ej. "En los próximos 3 a 6 meses" */
  tiempoClean: string;
  /** Categoría normalizada para la gráfica de dona */
  motivoCategoria: MotivoCategoria;
  /** Estado del lead en HubSpot (propiedad hs_lead_status), ej. "Intento de contacto" */
  estadoLeadCrm?: string;
  /** Etapa del lead en HubSpot (propiedad personalizada configurable) */
  etapaLeadCrm?: string;
  /** Propietario del contacto en HubSpot (ya resuelto a nombre) */
  propietarioCrm?: string;
  /** Cualquier propiedad extra de HubSpot pedida vía HUBSPOT_EXTRA_PROPERTIES */
  crmExtra?: Record<string, string>;
  /** Estado del lead en GoHighLevel (nombre del Stage), ej. "Registro", "Contacto" */
  estadoGHL?: string;
  /** Pipeline del lead en GoHighLevel */
  pipelineGHL?: string;
  /** Persona encargada del lead en GoHighLevel */
  personaEncargadaGHL?: string;
}