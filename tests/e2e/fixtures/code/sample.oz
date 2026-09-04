% Oz: functors, records, pattern matching, threads.
functor
import
   System
define
   Limit = 5 * 1024 * 1024

   fun {IsLarge N} N.size > Limit end

   fun {GroupByTag Notes}
      D = {Dictionary.new}
   in
      for N in Notes do
         if {Not {IsLarge N}} then
            for T in N.tags do
               {Dictionary.put D T N|{Dictionary.condGet D T nil}}
            end
         end
      end
      {Dictionary.toRecord tags D}
   end

   thread {System.showInfo "ready"} end
   {System.show {GroupByTag [note(path:"a.md" tags:[x y] size:12)]}}
end
