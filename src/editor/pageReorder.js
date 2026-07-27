export async function settlePageReorder(request, { onSuccess, onRollback, onError } = {}) {
  try {
    const result = await request();
    if (!result) {
      onRollback?.();
      return null;
    }
    onSuccess?.(result);
    return result;
  } catch (error) {
    onRollback?.();
    onError?.(error);
    return null;
  }
}
