-- El presupuesto Original es evidencia historica una vez que el periodo empieza.
-- Los DELETE de usuario deben convertirse en Cancelada; este trigger es una
-- ultima barrera contra deletes directos desde Prisma/SQL que se salten la API.
--
-- Se permite borrar una plantilla futura sin movimientos para que la logica de
-- recurrencias pueda regenerar ocurrencias que aun no han entrado en vigor.
CREATE OR REPLACE FUNCTION protect_presupuesto_history_delete()
RETURNS TRIGGER AS $$
DECLARE
  periodo_iniciado BOOLEAN;
  tiene_movimientos BOOLEAN;
BEGIN
  SELECT COALESCE(
    q."fecha_inicio" <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::date,
    FALSE
  )
  INTO periodo_iniciado
  FROM "quincenas" q
  WHERE q."id" = OLD."quincena_id";

  SELECT EXISTS (
    SELECT 1
    FROM "transacciones" t
    WHERE t."presupuesto_id" = OLD."id"
  ) INTO tiene_movimientos;

  IF COALESCE(periodo_iniciado, FALSE) OR COALESCE(tiene_movimientos, FALSE) THEN
    RAISE EXCEPTION
      'Presupuesto % tiene historia y no puede eliminarse fisicamente; usa Cancelada',
      OLD."id"
      USING ERRCODE = '23503';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_protect_presupuesto_history_delete" ON "presupuesto";
CREATE TRIGGER "trg_protect_presupuesto_history_delete"
BEFORE DELETE ON "presupuesto"
FOR EACH ROW
EXECUTE FUNCTION protect_presupuesto_history_delete();
