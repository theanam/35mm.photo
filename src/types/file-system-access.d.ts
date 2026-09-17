/**
 * File System Access API. Still absent from TypeScript's DOM lib, so the parts
 * 35mm relies on are declared here rather than cast away at each call site.
 */

interface FilePickerAcceptType {
  description?: string
  accept: Record<string, string | string[]>
}

interface OpenFilePickerOptions {
  multiple?: boolean
  excludeAcceptAllOption?: boolean
  types?: FilePickerAcceptType[]
  id?: string
  startIn?: string | FileSystemHandle
}

interface SaveFilePickerOptions {
  suggestedName?: string
  excludeAcceptAllOption?: boolean
  types?: FilePickerAcceptType[]
  id?: string
  startIn?: string | FileSystemHandle
}

interface DirectoryPickerOptions {
  id?: string
  mode?: 'read' | 'readwrite'
  startIn?: string | FileSystemHandle
}

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FileSystemHandle {
  queryPermission?(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>
  requestPermission?(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>
  keys(): AsyncIterableIterator<string>
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
}

interface Window {
  showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>
  showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>
  showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>
}

interface HTMLInputElement {
  /** Non-standard, but the only way to offer a folder picker in the fallback. */
  webkitdirectory: boolean
}
