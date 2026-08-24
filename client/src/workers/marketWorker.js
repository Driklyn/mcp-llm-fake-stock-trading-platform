self.onmessage = (event) => {
  const { points = [] } = event.data || {};

  if (!Array.isArray(points) || points.length === 0) {
    self.postMessage({ points: [] });
    return;
  }

  const normalized = points.map((point) => {
    if (typeof point === "number") {
      return {
        value: Number(point),
        timestamp: null,
      };
    }

    if (point && typeof point === "object") {
      const value = Number(point.price ?? point.value ?? 0);
      const timestamp = Number(point.timestamp ?? point.time ?? null);
      return {
        value: Number.isFinite(value) ? value : 0,
        timestamp: Number.isFinite(timestamp) ? timestamp : null,
      };
    }

    return { value: 0, timestamp: null };
  });

  const valid = normalized.filter(
    (point) => Number.isFinite(point.value) && point.value > 0,
  );
  if (valid.length === 0) {
    self.postMessage({ points: [] });
    return;
  }

  self.postMessage({ points: valid });
};
