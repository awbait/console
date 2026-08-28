-- One service name per namespace, not per cluster.
--
-- The old key (team, chart_name, service_name, cluster) let a team run a chart
-- under a given name once per cluster, so the second "abc" - the same thing in
-- another namespace, dev beside stage - was refused as a duplicate. Two
-- namespaces are two different places, and the same name in both is ordinary.
--
-- The namespace joins the key by its effective value: an empty namespace column
-- means "the service's own name" (models.Request.DestNamespace), so an order
-- that left the field empty has to collide with one that spelled that namespace
-- out. COALESCE(NULLIF(...)) is what makes the two the same key.
DROP INDEX IF EXISTS uniq_active_service;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_service
  ON requests (team, chart_name, service_name, cluster,
               COALESCE(NULLIF(namespace, ''), service_name))
  WHERE deleted_at IS NULL;
