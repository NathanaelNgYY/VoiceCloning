export function resolveTrainingSource({ directFiles = [], selectedLibraryIds = [] } = {}) {
  if (Array.from(selectedLibraryIds || []).filter(Boolean).length > 0) {
    return 'library';
  }
  if (Array.from(directFiles || []).length > 0) {
    return 'direct';
  }
  return 'none';
}

export function describeTrainingSelection({ directFiles = [], selectedLibraryIds = [] } = {}) {
  const source = resolveTrainingSource({ directFiles, selectedLibraryIds });
  if (source === 'library') {
    const count = Array.from(selectedLibraryIds || []).filter(Boolean).length;
    return `${count} shared clip${count === 1 ? '' : 's'} selected`;
  }
  if (source === 'direct') {
    const count = Array.from(directFiles || []).length;
    return `${count} direct clip${count === 1 ? '' : 's'} queued`;
  }
  return 'No clips';
}

export function getTrainingLibraryOverflowHint(fileCount = 0) {
  const count = Number(fileCount || 0);
  if (count <= 2) {
    return '';
  }
  return `Scroll to browse all ${count} shared files.`;
}

export function getTrainingLibraryScrollAreaClass(fileCount = 0) {
  const count = Number(fileCount || 0);
  return count > 2 ? 'h-[280px]' : 'max-h-[280px]';
}
