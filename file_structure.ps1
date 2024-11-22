# Set working directory
Set-Location -Path "C:\VSCode\fftcg-sync-service"

# Create exclusion filters
$excludedDirs = @('node_modules', 'functions-backup', 'functions\lib', 'functions\node_modules')
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
        <root_directory>C:\VSCode\fftcg-sync-service</root_directory>
        <generated_date>$((Get-Date -Format "yyyy-MM-dd HH:mm:ss"))</generated_date>
    </metadata>
    <directories>
        <functions>
            <directories>
"@

# Get functions directory and its subdirectories
$functionsDirs = Get-ChildItem -Path ".\functions\src" -Directory -Recurse | 
    Where-Object { 
        $dir = $_.FullName.Replace("$PWD\", "")
        -not ($excludedDirs | Where-Object { $dir -like "$_*" })
    }

foreach ($dir in $functionsDirs) {
    $relativePath = $dir.FullName.Replace("$PWD\", "")
    $xmlContent += "                <directory>$([System.Security.SecurityElement]::Escape($relativePath))</directory>`n"
}

$xmlContent += @"
            </directories>
            <files>
"@

# Get files in functions directory
$functionsFiles = Get-ChildItem -Path ".\functions\src" -File -Recurse | 
    Where-Object { 
        $file = $_
        $relativePath = $file.FullName.Replace("$PWD\", "")
        -not ($excludedDirs | Where-Object { $relativePath -like "$_*" }) -and
        -not ($excludedExtensions | Where-Object { $file.Extension -eq $_ })
    }

foreach ($file in $functionsFiles) {
    $path = [System.Security.SecurityElement]::Escape($file.FullName.Replace("$PWD\", ""))
    $xmlContent += "                <file>$path</file>`n"
}

$xmlContent += @"
            </files>
        </functions>
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