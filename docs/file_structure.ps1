# Set working directory
Set-Location -Path "C:\VSCode\fftcg-sync-service\docs"

# Create exclusion filters
$excludedDirs = @(
    'node_modules', 
    'functions-backup', 
    'functions\lib', 
    'functions\node_modules',
    '.vitepress\cache',
    '.vitepress\dist'
)
$excludedExtensions = @('.tmp', '.temp', '.log')
$excludedRootFiles = @(
    '.gitignore',
    'codebase.xml',
    'file_structure.ps1',
    'file_structure.xml',
    'service_account_key.json'
)

# Initialize XML content
$xmlContent = @"
<?xml version="1.0" encoding="UTF-8"?>
<file_structure>
    <metadata>
        <root_directory>C:\VSCode\fftcg-sync-service\docs</root_directory>
        <generated_date>$((Get-Date -Format "yyyy-MM-dd HH:mm:ss"))</generated_date>
    </metadata>
    <directories>
"@

# Function to process directory
function Get-DirectoryStructure {
    param (
        [string]$dirPath,
        [string]$indentation = "        "
    )

    $xmlContent = ""
    $xmlContent += "$indentation<$($dirPath.TrimStart('.\'))>`n"
    $xmlContent += "$indentation    <directories>`n"

    # Get directories
    $dirs = Get-ChildItem -Path $dirPath -Directory -Recurse | 
        Where-Object { 
            $dir = $_.FullName.Replace("$PWD\", "")
            -not ($excludedDirs | Where-Object { $dir -like "$_*" })
        }

    foreach ($dir in $dirs) {
        $relativePath = $dir.FullName.Replace("$PWD\", "")
        $xmlContent += "$indentation        <directory>$([System.Security.SecurityElement]::Escape($relativePath))</directory>`n"
    }

    $xmlContent += "$indentation    </directories>`n"
    $xmlContent += "$indentation    <files>`n"

    # Get files
    $files = Get-ChildItem -Path $dirPath -File -Recurse | 
        Where-Object { 
            $file = $_
            $relativePath = $file.FullName.Replace("$PWD\", "")
            -not ($excludedDirs | Where-Object { $relativePath -like "$_*" }) -and
            -not ($excludedExtensions | Where-Object { $file.Extension -eq $_ })
        }

    foreach ($file in $files) {
        $path = [System.Security.SecurityElement]::Escape($file.FullName.Replace("$PWD\", ""))
        $xmlContent += "$indentation        <file>$path</file>`n"
    }

    $xmlContent += "$indentation    </files>`n"
    $xmlContent += "$indentation</$($dirPath.TrimStart('.\'))>`n"

    return $xmlContent
}

# Process each directory
$directories = @('.vitepress', 'api', 'services', 'setup', 'utils')
foreach ($dir in $directories) {
    $xmlContent += Get-DirectoryStructure -dirPath ".\$dir"
}

# Add root files section
$xmlContent += @"
    </directories>
    <root_files>
"@

# Get root files
$rootFiles = Get-ChildItem -Path "." -File | 
    Where-Object { 
        -not ($excludedRootFiles -contains $_.Name) -and
        -not ($excludedExtensions | Where-Object { $_.Extension -eq $_ })
    }

foreach ($file in $rootFiles) {
    $path = [System.Security.SecurityElement]::Escape($file.FullName.Replace("$PWD\", ""))
    $xmlContent += "        <file>$path</file>`n"
}

$xmlContent += @"
    </root_files>
</file_structure>
"@

# Save the XML file
$xmlContent | Out-File -FilePath "file_structure.xml" -Encoding UTF8

Write-Host "file_structure.xml has been created successfully!"