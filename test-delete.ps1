# Test the DELETE endpoint for the storage API
$headers = @{ 
    "Authorization" = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NzNlMWNmYjA1ZDU0NGU3NzZlM2ZjMmIiLCJlbWFpbCI6ImhpbWFuc2h1YmFybmF3YWwyNkBnbWFpbC5jb20iLCJpYXQiOjE3MzIwMzQ3NjcsImV4cCI6MTczMjEyMTE2N30.6cqJ9t2TCqEg-r_kFJGN8wuYPt9fXiwhpJ_aKSSEYwI"
    "Content-Type" = "application/json"
}

$url = "http://localhost:8000/api/storage/object/himanshubarnwal26_gmail_com-35aebtgz/builds/5a8981e8-0021-41ad-9119-af0381e3da5d/source.zip"

Write-Host "Testing DELETE: $url"

try {
    $response = Invoke-WebRequest -Uri $url -Method DELETE -Headers $headers
    Write-Host "✅ Success: Status $($response.StatusCode)"
    Write-Host "Response: $($response.Content)"
} catch {
    Write-Host "❌ Error: $($_.Exception.Response.StatusCode) - $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $responseBody = $reader.ReadToEnd()
        Write-Host "Error Response: $responseBody"
    }
}