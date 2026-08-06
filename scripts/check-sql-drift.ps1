$ErrorActionPreference = 'Stop'
$root = 'G:\new-ui'
$canonical = @('schema.sql','rls.sql','triggers.sql','customer.sql','employee.sql','order.sql','commission.sql','refund.sql','system.sql','auth.sql','seed.sql','product.sql')
$pattern = '(?im)create\s+or\s+replace\s+function\s+(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)\('

function Get-FuncNames([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return @() }
  $t = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
  $names = @{}
  foreach ($m in [regex]::Matches($t, $pattern)) { $names[$m.Groups[1].Value.ToLower()] = $true }
  return $names.Keys
}

$allInOne = Get-FuncNames (Join-Path $root 'ALL_IN_ONE.sql')
$moduleUnion = @{}
foreach ($f in $canonical) {
  $path = Join-Path (Join-Path $root 'sql') $f
  foreach ($n in (Get-FuncNames $path)) { $moduleUnion[$n] = $true }
}

$inAllNotMod = @($allInOne | Where-Object { -not $moduleUnion.ContainsKey($_) })
$inModNotAll = @($moduleUnion.Keys | Where-Object { $_ -notin $allInOne })

Write-Output ("ALL_IN_ONE funcs: " + $allInOne.Count + " | module union: " + $moduleUnion.Count)
Write-Output ("--- in ALL_IN_ONE but NOT in canonical modules (" + $inAllNotMod.Count + ") ---")
$inAllNotMod | Sort-Object | ForEach-Object { Write-Output "  $_" }
Write-Output ("--- in canonical modules but NOT in ALL_IN_ONE (" + $inModNotAll.Count + ") ---")
$inModNotAll | Sort-Object | ForEach-Object { Write-Output "  $_" }
Write-Output '--- one-off files present funcs ---'
foreach ($f in @('adjust_order_price.sql','delete_order_all_status.sql','fix_vip_rule_encoding.sql','create_admin.sql','create_manager.sql','p0_security_fixes.sql')) {
  $ns = @(Get-FuncNames (Join-Path (Join-Path $root 'sql') $f))
  Write-Output ("  {0}: {1}" -f $f, ($ns -join ', '))
}