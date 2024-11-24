// .vitepress/utils/fileStructureParser.ts

// Define the interface once
interface FileStructure {
  directories: {
    [key: string]: {
      directories: string[]
      files: string[]
    }
  }
  root_files: string[]
  metadata?: {
    root_directory: string
    generated_date: string
  }
}

// Export the interface as a type
export type { FileStructure }

// Parse XML function
export function parseFileStructure(xmlText: string): FileStructure {
  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml')
  
  const structure: FileStructure = {
    directories: {},
    root_files: [],
    metadata: {
      root_directory: '',
      generated_date: ''
    }
  }

  // Parse metadata
  const metadata = xmlDoc.querySelector('metadata')
  if (metadata) {
    const rootDir = metadata.querySelector('root_directory')
    const genDate = metadata.querySelector('generated_date')
    structure.metadata = {
      root_directory: rootDir?.textContent || '',
      generated_date: genDate?.textContent || ''
    }
  }

  // Parse directories section
  const directoriesSection = xmlDoc.querySelector('directories')
  if (directoriesSection) {
    // Process functions directory and its subdirectories
    const functionsDir = directoriesSection.querySelector('functions')
    if (functionsDir) {
      // Initialize the functions directory
      structure.directories['functions'] = {
        directories: [],
        files: []
      }

      // Process subdirectories
      const directories = functionsDir.querySelector('directories')
      if (directories) {
        directories.querySelectorAll('directory').forEach(dir => {
          const dirPath = dir.textContent?.trim()
          if (dirPath) {
            const parts = dirPath.split('\\').join('/').split('/')
            let currentPath = ''
            
            parts.forEach((part, index) => {
              const path = index === 0 ? part : `${currentPath}/${part}`
              if (!structure.directories[path]) {
                structure.directories[path] = {
                  directories: [],
                  files: []
                }
              }
              if (index > 0) {
                const parentPath = parts.slice(0, index).join('/')
                if (!structure.directories[parentPath].directories.includes(path)) {
                  structure.directories[parentPath].directories.push(path)
                }
              }
              currentPath = path
            })
          }
        })
      }

      // Process files
      const files = functionsDir.querySelector('files')
      if (files) {
        files.querySelectorAll('file').forEach(file => {
          const filePath = file.textContent?.trim()
          if (filePath) {
            const normalizedPath = filePath.split('\\').join('/')
            const parts = normalizedPath.split('/')
            const fileName = parts.pop() || ''
            const dirPath = parts.join('/')
            
            if (dirPath && structure.directories[dirPath]) {
              if (!structure.directories[dirPath].files.includes(fileName)) {
                structure.directories[dirPath].files.push(fileName)
              }
            }
          }
        })
      }
    }
  }

  // Parse root files
  const rootFilesSection = xmlDoc.querySelector('root_files')
  if (rootFilesSection) {
    rootFilesSection.querySelectorAll('file').forEach(file => {
      const fileName = file.textContent?.trim()
      if (fileName && !structure.root_files.includes(fileName)) {
        structure.root_files.push(fileName)
      }
    })
  }

  // Sort all arrays
  structure.root_files.sort()
  Object.values(structure.directories).forEach(dir => {
    dir.directories.sort()
    dir.files.sort()
  })

  return structure
}

// Helper function to normalize file paths
function normalizePath(path: string): string {
  return path.split('\\').join('/')
}

// Helper function to get file extension
export function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || ''
}

// Helper function to check if a file should be hidden
export function isHiddenFile(filename: string): boolean {
  return filename.startsWith('.')
}

// Helper function to group files by type
export function groupFilesByType(files: string[]): Record<string, string[]> {
  return files.reduce((acc, file) => {
    const ext = getFileExtension(file)
    if (!acc[ext]) {
      acc[ext] = []
    }
    acc[ext].push(file)
    return acc
  }, {} as Record<string, string[]>)
}

// Utility function to add a directory to the structure
export function addDirectory(
  structure: FileStructure,
  path: string
): void {
  const normalizedPath = normalizePath(path)
  if (!structure.directories[normalizedPath]) {
    structure.directories[normalizedPath] = {
      directories: [],
      files: []
    }
    
    // Update parent directory
    const parts = normalizedPath.split('/')
    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join('/')
      if (!structure.directories[parentPath]) {
        addDirectory(structure, parentPath)
      }
      if (!structure.directories[parentPath].directories.includes(normalizedPath)) {
        structure.directories[parentPath].directories.push(normalizedPath)
      }
    }
  }
}

// Utility function to add a file to the structure
export function addFile(
  structure: FileStructure,
  filePath: string,
  isRootFile: boolean = false
): void {
  const normalizedPath = normalizePath(filePath)
  if (isRootFile) {
    if (!structure.root_files.includes(normalizedPath)) {
      structure.root_files.push(normalizedPath)
    }
    return
  }

  const parts = normalizedPath.split('/')
  const fileName = parts.pop() || ''
  const dirPath = parts.join('/')

  if (dirPath) {
    if (!structure.directories[dirPath]) {
      addDirectory(structure, dirPath)
    }
    if (!structure.directories[dirPath].files.includes(fileName)) {
      structure.directories[dirPath].files.push(fileName)
    }
  } else {
    addFile(structure, fileName, true)
  }
}

// Utility function to validate the file structure
export function validateFileStructure(structure: FileStructure): boolean {
  // Check required properties
  if (!structure.directories || !structure.root_files) {
    return false
  }

  // Validate directories
  for (const [path, dir] of Object.entries(structure.directories)) {
    // Check directory has required properties
    if (!dir.directories || !dir.files) {
      return false
    }

    // Validate subdirectories
    for (const subDir of dir.directories) {
      if (!structure.directories[subDir]) {
        return false
      }
    }

    // Validate path format
    if (path.includes('\\')) {
      return false
    }
  }

  return true
}