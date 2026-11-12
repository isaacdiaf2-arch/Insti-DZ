import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listInstitutionDirectory } from "@/lib/directory.functions";
import { getScheduleRows } from "@/lib/curriculum.functions";
import { cacheSchedules, readCachedSchedules, type ScheduleRow } from "@/lib/schedule";

/**
 * جدول العضو (أستاذ أو طالب) مع دعم وضع عدم الاتصال 24 ساعة (للعرض فقط).
 */
export function useScheduleView(params: {
  institutionId?: string;
  teacherId?: string;
  classIds?: string[];
  cacheKey: string;
}) {
  const { institutionId, teacherId, classIds, cacheKey } = params;
  const [offlineAt, setOfflineAt] = useState<number | null>(null);
  const [fallback, setFallback] = useState<ScheduleRow[] | null>(null);

  const fetchScheduleFn = useServerFn(getScheduleRows);

  const query = useQuery({
    queryKey: ["schedule-view", cacheKey, institutionId, teacherId, classIds?.join(",")],
    enabled: !!institutionId,
    queryFn: async () => {
      const data = await fetchScheduleFn({
        data: {
          institutionId,
          teacherId,
          classIds,
        },
      });
      const rows = (data ?? []) as unknown as ScheduleRow[];
      cacheSchedules(cacheKey, rows);
      return rows;
    },
  });

  const directoryFn = useServerFn(listInstitutionDirectory);
  const teachersQuery = useQuery({
    queryKey: ["schedule-view", "teachers", institutionId],
    enabled: !!institutionId,
    queryFn: async () => await directoryFn(),
  });

  useEffect(() => {
    if (query.isError && !fallback) {
      const cached = readCachedSchedules<ScheduleRow[]>(cacheKey);
      if (cached) {
        setFallback(cached.rows);
        setOfflineAt(cached.at);
      }
    }
  }, [query.isError, fallback, cacheKey]);

  const teacherNames = useMemo(
    () =>
      Object.fromEntries(
        (teachersQuery.data ?? []).map((t: { id: string; first_name: string; last_name: string }) => [
          t.id,
          `${t.first_name} ${t.last_name}`,
        ]),
      ) as Record<string, string>,
    [teachersQuery.data],
  );

  return {
    rows: query.data ?? fallback ?? [],
    teacherNames,
    offlineAt,
    isLoading: query.isLoading,
  };
}
