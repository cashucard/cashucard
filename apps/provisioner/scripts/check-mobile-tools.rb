# Hardware-free release toolchain check. Never signs, installs pods or calls stores.
require 'bundler'
require 'fastlane'
require 'cfpropertylist'
require 'tmpdir'

abort 'Bundler does not match Gemfile.lock' unless Bundler::VERSION == Bundler.locked_gems.bundler_version.to_s
Bundler.root
Dir.mktmpdir('cashu-plist-smoke-') do |directory|
  path = File.join(directory, 'fixture.plist')
  expected = {'tool' => 'provisioner', 'version' => 1}
  document = CFPropertyList::List.new
  document.value = CFPropertyList.guess(expected)
  document.save(path, CFPropertyList::List::FORMAT_XML)
  actual = CFPropertyList.native_types(CFPropertyList::List.new(file: path).value)
  abort 'Property list round trip failed' unless actual == expected
end
puts 'Locked Bundler/Fastlane loaded; property-list round trip passed.'
