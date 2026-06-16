// Лёгкое сравнение semver-версий чартов (без диапазонов): нужно, чтобы понять,
// «новее» ли благословлённая версия, чем версия заказа. Префикс «v» игнорируется,
// pre-release-суффикс (1.2.3-rc1) отбрасывается — для каталога Helm-чартов
// достаточно сравнения major.minor.patch.

function parse(v: string): number[] {
  const core = v.trim().replace(/^v/i, "").split(/[-+]/)[0];
  return core.split(".").map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

// compareSemver: -1 если a<b, 0 если равны, 1 если a>b.
export function compareSemver(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

// isNewer сообщает, что candidate строго новее, чем current.
export function isNewer(candidate: string, current: string): boolean {
  return !!candidate && !!current && compareSemver(candidate, current) > 0;
}

// upgradeTargets возвращает версии чарта, до которых заказу на версии current
// разрешено обновиться: строго новее current и не выше approved (версии, под
// которую автор согласовал форму, - дальше форма не гарантирована). Список
// отсортирован от новой к старой; пустой, если апгрейд недоступен. Это
// единственный источник допустимых версий апгрейда (и для UI, и для проверки
// ?to= на странице заказа), чтобы нельзя было открыть обновление до
// несуществующей/недопустимой версии.
export function upgradeTargets(versions: string[], current: string, approved?: string): string[] {
  if (!approved || !isNewer(approved, current)) return [];
  return versions
    .filter((v) => isNewer(v, current) && !isNewer(v, approved))
    .sort((a, b) => compareSemver(b, a));
}
